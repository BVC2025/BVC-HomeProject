import { useCallback, useEffect, useState } from "react";
import { customFieldService } from "../services/customFieldService";

export function useCustomFields(tableName) {
  const [fields, setFields] = useState([]);
  const [cfValues, setCfValues] = useState({});

  const fetchFields = useCallback(async () => {
    if (!tableName) return;
    try {
      const r = await customFieldService.getFields(tableName);
      const sorted = (r.data || []).sort((a, b) => a.SORT_ORDER - b.SORT_ORDER);
      setFields(sorted);
    } catch {}
  }, [tableName]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  const loadValues = useCallback(async (rowId) => {
    if (!rowId) { setCfValues({}); return; }
    try {
      const r = await customFieldService.getValues(tableName, String(rowId));
      const vals = {};
      (r.data || []).forEach((v) => { vals[v.CUSTOM_FIELD_ID] = v.CUSTOM_FIELD_VALUE; });
      setCfValues(vals);
    } catch { setCfValues({}); }
  }, [tableName]);

  const resetValues = useCallback(() => setCfValues({}), []);

  const handleCfChange = useCallback((fieldId, value) => {
    setCfValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const validateCf = useCallback(() => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

    for (const field of fields) {
      const val = cfValues[field.ID];
      const empty =
        val === undefined || val === "" || val === null ||
        (Array.isArray(val) && val.length === 0);

      if (field.IS_REQUIRED && empty) {
        return `"${field.FIELD_NAME}" is required`;
      }

      if (!empty) {
        switch (field.FIELD_TYPE) {
          case "EMAIL":
            if (!EMAIL_RE.test(String(val))) {
              return `"${field.FIELD_NAME}" must be a valid email address (e.g. user@example.com)`;
            }
            break;
          case "PHONE":
            if (!PHONE_RE.test(String(val).trim())) {
              return `"${field.FIELD_NAME}" must be a valid phone number`;
            }
            break;
          case "NUMBER":
            if (isNaN(Number(val))) {
              return `"${field.FIELD_NAME}" must be a number`;
            }
            break;
          case "DATE":
          case "DATETIME":
            if (isNaN(new Date(val).getTime())) {
              return `"${field.FIELD_NAME}" must be a valid date`;
            }
            break;
          case "SELECT":
          case "RADIO": {
            const opts = Array.isArray(field.OPTIONS) ? field.OPTIONS : [];
            if (opts.length > 0 && !opts.includes(val)) {
              return `"${field.FIELD_NAME}": "${val}" is not a valid option. Allowed: ${opts.join(", ")}`;
            }
            break;
          }
          case "CHECKBOX": {
            const opts = Array.isArray(field.OPTIONS) ? field.OPTIONS : [];
            if (opts.length > 0 && Array.isArray(val)) {
              const invalid = val.filter((v) => !opts.includes(v));
              if (invalid.length > 0) {
                return `"${field.FIELD_NAME}": "${invalid.join(", ")}" are not valid options. Allowed: ${opts.join(", ")}`;
              }
            }
            break;
          }
          default:
            break;
        }
      }
    }
    return null;
  }, [fields, cfValues]);

  const saveCfValues = useCallback(async (rowId) => {
    for (const field of fields) {
      const raw = cfValues[field.ID];
      if (raw === undefined) continue; // never touched — no row to write or clear
      // Normalize empty values to null so cleared optional fields are persisted
      const value = (raw === "" || (Array.isArray(raw) && raw.length === 0)) ? null : raw;
      try {
        await customFieldService.upsertValue({
          TABLE_NAME: tableName,
          TABLE_ROW_ID: String(rowId),
          CUSTOM_FIELD_ID: field.ID,
          CUSTOM_FIELD_VALUE: value,
        });
      } catch { /* silent */ }
    }
  }, [fields, cfValues, tableName]);

  return {
    fields,
    cfValues,
    handleCfChange,
    loadValues,
    resetValues,
    validateCf,
    saveCfValues,
    refreshFields: fetchFields,
  };
}

export function useTableCfValues(tableName, rows) {
  const [valuesMap, setValuesMap] = useState({});

  useEffect(() => {
    if (!tableName || !rows || rows.length === 0) { setValuesMap({}); return; }
    customFieldService.getAllValues(tableName).then((res) => {
      const map = {};
      (res.data || []).forEach((v) => {
        const rid = String(v.TABLE_ROW_ID);
        if (!map[rid]) map[rid] = {};
        map[rid][v.CUSTOM_FIELD_ID] = v.CUSTOM_FIELD_VALUE;
      });
      setValuesMap(map);
    }).catch(() => {});
  }, [tableName, rows]);

  return valuesMap;
}
