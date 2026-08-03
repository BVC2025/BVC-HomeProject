"""Generic, module-agnostic negotiation state machine — deterministic,
compounding, round-by-round price counters for any AI module's own
pricing tool. All bookkeeping (which round this is, what was last
offered/countered) lives here, server-side, in AINegotiationState —
never inferred from raw chat history and never left to the LLM to track,
since weaker fallback models have already shown themselves unreliable at
multi-step bookkeeping. Operates only on primitives (prices, a percent, a
generic session/module/entity key) — no knowledge of Project/ProjectPricing
or any other lead_module concept, so a future module's own pricing tool can
reuse this exact function for its own negotiable entity."""

from typing import Optional

from sqlalchemy.orm import Session

from app.models.rag_models import AINegotiationState

_ROUNDING_STEP = 500.0


def _round_down(value: float, step: float = _ROUNDING_STEP) -> float:

    if step <= 0 or value <= 0:

        return max(value, 0.0)

    return float(int(value // step) * step)


def _get_or_create_state(db: Session, session_id: str, module_code: str, entity_id: str) -> AINegotiationState:

    state = (
        db.query(AINegotiationState)
        .filter(
            AINegotiationState.SESSION_ID == session_id,
            AINegotiationState.MODULE_CODE == module_code,
            AINegotiationState.ENTITY_ID == entity_id,
        )
        .first()
    )

    if state is None:

        state = AINegotiationState(SESSION_ID=session_id, MODULE_CODE=module_code, ENTITY_ID=entity_id)

        db.add(state)

    return state


def evaluate_offer(
    db: Session,
    session_id: str,
    module_code: str,
    entity_id: str,
    list_price: float,
    min_price: Optional[float],
    negotiation_percent: Optional[float],
    offered_price: float,
) -> dict:
    """Returns {"acceptable": bool, "counter_price": float|None} — the only
    two fields the LLM ever sees; round number, exact pre-rounding value,
    and every other internal detail stay server-side.

    Rules, in order:
    1. Replay guard — an identical offered_price to last time returns the
       exact same stored outcome, without advancing a round (covers the
       model calling the tool more than once for a single customer
       message).
    2. Already-met guard — a new offer that already meets or beats the
       previously displayed counter is accepted outright; no further
       reduction is computed even if a lower round would technically be
       available, since we already named that price.
    3. Otherwise, advance one round: compound off the previous round's
       *unrounded* value (list_price for round 1), clamp to min_price,
       round down to a natural sales figure, and clamp so a counter can
       never exceed one already quoted.
    """

    state = _get_or_create_state(db, session_id, module_code, entity_id)

    if state.LIST_PRICE_SNAPSHOT is None:

        state.LIST_PRICE_SNAPSHOT = list_price

    offered = float(offered_price)

    # 1. Replay guard.
    if state.LAST_OFFERED_PRICE is not None and float(state.LAST_OFFERED_PRICE) == offered:

        db.commit()

        counter = float(state.LAST_DISPLAYED_COUNTER) if (not state.LAST_ACCEPTABLE and state.LAST_DISPLAYED_COUNTER is not None) else None

        return {"acceptable": bool(state.LAST_ACCEPTABLE), "counter_price": counter}

    # 2. Already-met guard (skipped on the very first-ever call, when
    # LAST_DISPLAYED_COUNTER is still None).
    if state.LAST_DISPLAYED_COUNTER is not None and offered >= float(state.LAST_DISPLAYED_COUNTER):

        state.LAST_OFFERED_PRICE = offered

        state.LAST_ACCEPTABLE = True

        db.commit()

        return {"acceptable": True, "counter_price": None}

    # 3. Advance one round.
    prev_reference = float(state.LAST_COUNTER_EXACT) if state.LAST_COUNTER_EXACT is not None else float(state.LIST_PRICE_SNAPSHOT)

    exact_n = prev_reference * (1 - float(negotiation_percent or 0) / 100.0)

    floor_n = max(float(min_price or 0), exact_n)

    acceptable = offered >= floor_n

    state.ROUND_NUMBER = (state.ROUND_NUMBER or 0) + 1

    state.LAST_OFFERED_PRICE = offered

    state.LAST_COUNTER_EXACT = exact_n

    state.LAST_ACCEPTABLE = acceptable

    if acceptable:

        db.commit()

        return {"acceptable": True, "counter_price": None}

    raw_counter = max(floor_n, min(offered, prev_reference))

    human_counter = _round_down(raw_counter)

    human_counter = max(human_counter, float(min_price or 0))

    if state.LAST_DISPLAYED_COUNTER is not None:

        human_counter = min(human_counter, float(state.LAST_DISPLAYED_COUNTER))

    state.LAST_DISPLAYED_COUNTER = human_counter

    db.commit()

    return {"acceptable": False, "counter_price": human_counter}
