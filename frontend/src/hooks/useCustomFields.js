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
    for (const field of fields) {
      if (field.IS_REQUIRED) {
        const val = cfValues[field.ID];
        if (val === undefined || val === "" || val === null) return field.FIELD_NAME;
        if (Array.isArray(val) && val.length === 0) return field.FIELD_NAME;
      }
    }
    return null;
  }, [fields, cfValues]);

  const saveCfValues = useCallback(async (rowId) => {
    for (const field of fields) {
      const value = cfValues[field.ID];
      if (value !== undefined && value !== null && value !== "") {
        try {
          await customFieldService.upsertValue({
            TABLE_NAME: tableName,
            TABLE_ROW_ID: String(rowId),
            CUSTOM_FIELD_ID: field.ID,
            CUSTOM_FIELD_VALUE: value,
          });
        } catch { /* silent */ }
      }
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
