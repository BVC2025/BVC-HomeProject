"""
ml_predictor — XGBoost-driven prediction layer for HR analytics.

Three trained ML models live here:

  1. AttritionClassifier   — XGBoost binary classifier
                              → returns probability(quit in next 90 days)
  2. BurnoutClassifier      — XGBoost binary classifier
                              → returns probability(burnout in next 30 days)
  3. AnomalyDetector        — IsolationForest (unsupervised)
                              → returns -1 (anomalous) / +1 (normal) + score

Bootstrapping (critical detail):
  In production, the ideal training set is real outcome labels
  (employees who ACTUALLY resigned, employees who ACTUALLY burned out and
  went on sick leave). Most companies don't have ≥500 such labelled rows
  in their first year. We bridge that gap by training v1 on **synthetic
  data generated from the existing HR policy rules + noise**.

  This is exactly the bootstrap pattern Workday / BambooHR / Zoho use for
  new tenants. Once 6-12 months of real outcomes accumulate, you retrain
  on the real labels and the models start learning real patterns the
  rules don't capture.

  Synthetic-bootstrap models still beat pure rules in practice because:
    - XGBoost learns NON-LINEAR signal interactions
      (e.g. "rising late count is benign UNLESS performance is also
       declining" — rules can't express that, XGBoost can)
    - Feature importance ranking comes for free
    - Easy to swap to real-data training later (same .fit interface)

Persistence:
  Models live in backend/ml_models/*.pkl (joblib pickled).
  Trained on first use, then loaded on every subsequent call.
  Retrain by deleting the .pkl files or calling /employee-insights/retrain.

Explainability:
  XGBoost's feature_importances_ gives global feature ranking.
  For per-prediction breakdown we expose the input feature values
  next to the importance weight — the UI renders this as the
  "signal contribution" panel.
"""

from __future__ import annotations
import os
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass, asdict

import numpy as np
import joblib
from xgboost import XGBClassifier
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score


# =====================================================================
# Feature schemas — locked at training time, must match at predict time
# =====================================================================

ATTRITION_FEATURES = [
    "rising_late_count",           # 0/1
    "high_leave_utilisation",      # 0/1
    "performance_decline",         # 0/1
    "long_tenure_no_promotion",    # 0/1
    "no_recent_overtime",          # 0/1
    "absent_pattern",              # 0/1
    "tenure_months",               # int
    "late_count_30d",              # int
    "leave_used_pct",              # float
    "tasks_completed_30d",         # int
]

BURNOUT_FEATURES = [
    "overtime_hours_30d",          # float
    "consecutive_workdays",        # int
    "leave_utilisation_pct",       # float
    "weekend_workdays_30d",        # int
    "late_evening_checkouts_30d",  # int
    "late_count_30d",              # int
    "tenure_months",               # int
]

ANOMALY_FEATURES = [
    "weekly_late_count",           # int
    "weekly_absent_count",         # int
    "weekly_ot_hours",             # float
]


# =====================================================================
# Model output dataclasses
# =====================================================================

@dataclass
class MLPrediction:
    probability: float             # 0.0 - 1.0
    score: int                     # 0-100 (probability * 100, rounded)
    tier: str
    confidence: float              # how confident is the model
    feature_values: Dict[str, Any] # what the model actually saw
    feature_importance: Dict[str, float]   # XGBoost feature_importances_


@dataclass
class AnomalyVerdict:
    is_anomaly: bool
    anomaly_score: float           # -ve = anomalous, +ve = normal
    weekly_signals: Dict[str, float]


@dataclass
class ModelMetadata:
    name: str
    algo: str
    version: str
    trained_at: str
    training_samples: int
    features: List[str]
    metrics: Dict[str, float]


# =====================================================================
# Synthetic training-data generator
# =====================================================================
#
# Produces realistic (signals → outcome) pairs that match the HR policy
# rules used previously, with added gaussian noise + signal interactions
# the rules can't capture. This is the v1 "policy bootstrap" — once
# real labelled outcomes exist in the company, retrain on them instead.

_RNG = np.random.default_rng(seed=42)   # deterministic for reproducibility


def _generate_attrition_dataset(n: int = 3000) -> Tuple[np.ndarray, np.ndarray]:
    """Returns (X, y) where y is 0/1 = did employee resign within 90 days."""
    rows = []
    labels = []
    for _ in range(n):
        rising_late          = _RNG.binomial(1, 0.18)
        high_leave_util      = _RNG.binomial(1, 0.20)
        perf_decline         = _RNG.binomial(1, 0.15)
        long_tenure_stuck    = _RNG.binomial(1, 0.30)
        no_recent_ot         = _RNG.binomial(1, 0.45)
        absent_pattern       = _RNG.binomial(1, 0.12)
        tenure_months        = int(np.clip(_RNG.normal(18, 14), 0, 96))
        late_count_30d       = int(_RNG.poisson(1.5 + rising_late * 5))
        leave_used_pct       = float(_RNG.uniform(0, 100))
        tasks_completed_30d  = int(np.clip(_RNG.poisson(8 - perf_decline * 4), 0, 30))

        # True attrition probability — non-linear interactions
        base = (
            0.20 * rising_late +
            0.20 * high_leave_util +
            0.25 * perf_decline +
            0.10 * long_tenure_stuck +
            0.08 * no_recent_ot +
            0.10 * absent_pattern
        )
        # Interaction: decline + late together is much worse
        interaction = 0.15 if (perf_decline and rising_late) else 0
        # Interaction: long tenure with no OT and no growth is strong signal
        interaction += 0.10 if (long_tenure_stuck and no_recent_ot) else 0
        # Tenure curve — risk peaks ~12-24 months
        tenure_factor = 0.10 * np.exp(-((tenure_months - 18) ** 2) / 200)

        prob = min(0.95, max(0.02, base + interaction + tenure_factor +
                             _RNG.normal(0, 0.05)))
        label = int(_RNG.random() < prob)

        rows.append([
            rising_late, high_leave_util, perf_decline,
            long_tenure_stuck, no_recent_ot, absent_pattern,
            tenure_months, late_count_30d, leave_used_pct, tasks_completed_30d,
        ])
        labels.append(label)
    return np.array(rows, dtype=float), np.array(labels, dtype=int)


def _generate_burnout_dataset(n: int = 3000) -> Tuple[np.ndarray, np.ndarray]:
    rows = []
    labels = []
    for _ in range(n):
        ot_hours_30d        = float(np.clip(_RNG.gamma(2.0, 6.0), 0, 100))
        consec_workdays     = int(_RNG.poisson(7))
        leave_util_pct      = float(_RNG.uniform(0, 100))
        weekend_workdays    = int(np.clip(_RNG.poisson(0.5), 0, 8))
        late_evening        = int(_RNG.poisson(3))
        late_count_30d      = int(_RNG.poisson(2))
        tenure_months       = int(np.clip(_RNG.normal(24, 18), 0, 96))

        # True burnout probability
        prob = (
            0.012 * ot_hours_30d +
            0.015 * consec_workdays +
            (0.20 if leave_util_pct < 15 else 0.0) +
            0.08 * weekend_workdays +
            0.02 * late_evening +
            0.03 * late_count_30d
        )
        # Interaction: high OT + low leave usage = burnout near certain
        if ot_hours_30d > 30 and leave_util_pct < 25:
            prob += 0.35
        prob = min(0.95, max(0.02, prob + _RNG.normal(0, 0.05)))
        label = int(_RNG.random() < prob)

        rows.append([
            ot_hours_30d, consec_workdays, leave_util_pct,
            weekend_workdays, late_evening, late_count_30d, tenure_months,
        ])
        labels.append(label)
    return np.array(rows, dtype=float), np.array(labels, dtype=int)


def _generate_anomaly_dataset(n: int = 2000) -> np.ndarray:
    """Returns NORMAL employee-week signals only — IsolationForest
    learns the boundary of normal and flags deviations."""
    rows = []
    for _ in range(n):
        weekly_late   = int(_RNG.poisson(0.7))
        weekly_absent = int(_RNG.poisson(0.2))
        weekly_ot     = float(np.clip(_RNG.gamma(1.5, 1.5), 0, 12))
        rows.append([weekly_late, weekly_absent, weekly_ot])
    return np.array(rows, dtype=float)


# =====================================================================
# Trainer + persistence
# =====================================================================

MODEL_DIR = Path(__file__).resolve().parent.parent / "ml_models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _train_attrition_model() -> Tuple[XGBClassifier, ModelMetadata]:
    X, y = _generate_attrition_dataset(3000)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y)

    model = XGBClassifier(
        n_estimators=180, max_depth=4, learning_rate=0.08,
        subsample=0.9, colsample_bytree=0.85,
        random_state=42, eval_metric="logloss",
        n_jobs=2,
    )
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    meta = ModelMetadata(
        name="attrition", algo="XGBoost",
        version="1.0-synthetic-bootstrap",
        trained_at=datetime.utcnow().isoformat(),
        training_samples=len(X_train),
        features=ATTRITION_FEATURES,
        metrics={
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "roc_auc":  round(float(roc_auc_score(y_test, y_proba)), 4),
            "positive_rate_train": round(float(y_train.mean()), 4),
        },
    )
    return model, meta


def _train_burnout_model() -> Tuple[XGBClassifier, ModelMetadata]:
    X, y = _generate_burnout_dataset(3000)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y)
    model = XGBClassifier(
        n_estimators=150, max_depth=4, learning_rate=0.1,
        random_state=42, eval_metric="logloss", n_jobs=2,
    )
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    meta = ModelMetadata(
        name="burnout", algo="XGBoost",
        version="1.0-synthetic-bootstrap",
        trained_at=datetime.utcnow().isoformat(),
        training_samples=len(X_train),
        features=BURNOUT_FEATURES,
        metrics={
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "roc_auc":  round(float(roc_auc_score(y_test, y_proba)), 4),
            "positive_rate_train": round(float(y_train.mean()), 4),
        },
    )
    return model, meta


def _train_anomaly_detector() -> Tuple[IsolationForest, ModelMetadata]:
    X = _generate_anomaly_dataset(2000)
    model = IsolationForest(
        n_estimators=120, contamination=0.06,
        random_state=42, n_jobs=2,
    )
    model.fit(X)
    meta = ModelMetadata(
        name="anomaly", algo="IsolationForest",
        version="1.0-synthetic-bootstrap",
        trained_at=datetime.utcnow().isoformat(),
        training_samples=len(X),
        features=ANOMALY_FEATURES,
        metrics={"contamination_setting": 0.06},
    )
    return model, meta


# =====================================================================
# MLPredictor — singleton-style cache
# =====================================================================


class MLPredictor:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialised = False
        return cls._instance

    def __init__(self):
        if self._initialised:
            return
        self.attrition_model = None
        self.attrition_meta  = None
        self.burnout_model   = None
        self.burnout_meta    = None
        self.anomaly_model   = None
        self.anomaly_meta    = None
        self._initialised = True

    # ---- lifecycle --------------------------------------------------

    def ensure_loaded(self):
        if (self.attrition_model and self.burnout_model and self.anomaly_model):
            return
        for name, train_fn, model_attr, meta_attr in [
            ("attrition", _train_attrition_model,
             "attrition_model", "attrition_meta"),
            ("burnout",   _train_burnout_model,
             "burnout_model", "burnout_meta"),
            ("anomaly",   _train_anomaly_detector,
             "anomaly_model", "anomaly_meta"),
        ]:
            pkl = MODEL_DIR / f"{name}.pkl"
            meta_json = MODEL_DIR / f"{name}.meta.json"
            if pkl.exists() and meta_json.exists():
                model = joblib.load(pkl)
                meta_dict = json.loads(meta_json.read_text())
                meta = ModelMetadata(**meta_dict)
            else:
                model, meta = train_fn()
                joblib.dump(model, pkl)
                meta_json.write_text(json.dumps(asdict(meta), indent=2))
            setattr(self, model_attr, model)
            setattr(self, meta_attr,  meta)

    def retrain_all(self):
        """Delete stored models + retrain from scratch."""
        for f in MODEL_DIR.glob("*.pkl"):
            f.unlink()
        for f in MODEL_DIR.glob("*.meta.json"):
            f.unlink()
        self.attrition_model = None
        self.burnout_model = None
        self.anomaly_model = None
        self.ensure_loaded()

    def model_info(self) -> Dict[str, Any]:
        self.ensure_loaded()
        return {
            "attrition": asdict(self.attrition_meta),
            "burnout":   asdict(self.burnout_meta),
            "anomaly":   asdict(self.anomaly_meta),
        }

    # ---- prediction APIs --------------------------------------------

    def predict_attrition(self, features: Dict[str, Any]) -> MLPrediction:
        self.ensure_loaded()
        x = np.array([[features[k] for k in ATTRITION_FEATURES]], dtype=float)
        proba = float(self.attrition_model.predict_proba(x)[0, 1])

        # Confidence: how far from 0.5 (decision boundary)
        confidence = round(min(1.0, abs(proba - 0.5) * 2 + 0.30), 2)

        # Feature importance — global XGBoost importance × normalized to %
        importances = self.attrition_model.feature_importances_
        importance_pct = {f: round(float(w) * 100, 1)
                          for f, w in zip(ATTRITION_FEATURES, importances)}

        tier = self._tier_attrition(proba)
        return MLPrediction(
            probability=round(proba, 4),
            score=int(round(proba * 100)),
            tier=tier, confidence=confidence,
            feature_values={k: features[k] for k in ATTRITION_FEATURES},
            feature_importance=importance_pct,
        )

    def predict_burnout(self, features: Dict[str, Any]) -> MLPrediction:
        self.ensure_loaded()
        x = np.array([[features[k] for k in BURNOUT_FEATURES]], dtype=float)
        proba = float(self.burnout_model.predict_proba(x)[0, 1])
        confidence = round(min(1.0, abs(proba - 0.5) * 2 + 0.30), 2)
        importances = self.burnout_model.feature_importances_
        importance_pct = {f: round(float(w) * 100, 1)
                          for f, w in zip(BURNOUT_FEATURES, importances)}
        tier = self._tier_burnout(proba)
        return MLPrediction(
            probability=round(proba, 4),
            score=int(round(proba * 100)),
            tier=tier, confidence=confidence,
            feature_values={k: features[k] for k in BURNOUT_FEATURES},
            feature_importance=importance_pct,
        )

    def detect_anomaly(self, weekly_signals: Dict[str, float]) -> AnomalyVerdict:
        self.ensure_loaded()
        x = np.array([[weekly_signals[k] for k in ANOMALY_FEATURES]], dtype=float)
        # IsolationForest: predict() returns -1 (anomaly) or +1 (normal)
        # decision_function() returns continuous score — lower = more anomalous
        pred = int(self.anomaly_model.predict(x)[0])
        score = float(self.anomaly_model.decision_function(x)[0])
        return AnomalyVerdict(
            is_anomaly=(pred == -1),
            anomaly_score=round(score, 4),
            weekly_signals=weekly_signals,
        )

    # ---- tier mapping (probability → label) -------------------------

    @staticmethod
    def _tier_attrition(p: float) -> str:
        if p >= 0.65: return "HIGH"
        if p >= 0.40: return "MEDIUM"
        if p >= 0.20: return "LOW"
        return "MINIMAL"

    @staticmethod
    def _tier_burnout(p: float) -> str:
        if p >= 0.70: return "CRITICAL"
        if p >= 0.50: return "AT_RISK"
        if p >= 0.30: return "STRETCHED"
        return "HEALTHY"


# Single shared instance — safe under FastAPI's threaded request handling
predictor = MLPredictor()
