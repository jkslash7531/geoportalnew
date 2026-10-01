/**
 * Universal Utility Functions for KMC Questionnaire Engine
 * Supports:
 * - Strict Language Character Filtering (Nepali-only vs English-only)
 * - Enterprise Skip Logic Condition Evaluation
 * - Operator definitions
 */

/**
 * Strips all Latin/English alphabet characters (A-Za-z) from text.
 * Keeps Devanagari script (\u0900-\u097F), digits, punctuation, and whitespace.
 */
export function filterNepaliOnly(text = '') {
  if (typeof text !== 'string') return '';
  return text.replace(/[a-zA-Z]/g, '');
}

/**
 * Strips all Devanagari script characters (\u0900-\u097F) from text.
 * Keeps ASCII / Latin characters, digits, punctuation, and whitespace.
 */
export function filterEnglishOnly(text = '') {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0900-\u097F]/g, '');
}

/**
 * Generates a clean database / PostGIS column identifier (snake_case, ASCII only).
 */
export function filterKeyIdentifier(text = '') {
  if (typeof text !== 'string') return '';
  const noDevanagari = text.replace(/[\u0900-\u097F]/g, '');
  return noDevanagari
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_');
}

/**
 * Skip Logic Operators
 */
export const SKIP_OPERATORS = [
  { id: '==', label: 'बराबर (Equals)', labelEn: 'Equals', requiresValue: true },
  { id: '!=', label: 'फरक (Not Equals)', labelEn: 'Not Equals', requiresValue: true },
  { id: '>', label: 'ठूलो (Greater Than >)', labelEn: 'Greater Than', requiresValue: true },
  { id: '<', label: 'सानो (Less Than <)', labelEn: 'Less Than', requiresValue: true },
  { id: '>=', label: 'ठूलो वा बराबर (>=)', labelEn: 'Greater or Equal', requiresValue: true },
  { id: '<=', label: 'सानो वा बराबर (<=)', labelEn: 'Less or Equal', requiresValue: true },
  { id: 'contains', label: 'समावेश भएको (Contains)', labelEn: 'Contains', requiresValue: true },
  { id: 'is_not_empty', label: 'उत्तर दिइएको (Answered / Not Empty)', labelEn: 'Is Not Empty', requiresValue: false },
  { id: 'is_empty', label: 'खाली भएको (Empty / Unanswered)', labelEn: 'Is Empty', requiresValue: false },
];

/**
 * Evaluates whether a question should be visible based on its conditions and logic.
 * 
 * @param {Object} question - The question definition
 * @param {Object} answers - Current dictionary of answers { [fieldName]: value }
 * @returns {boolean} - true if question should be rendered, false if skipped
 */
export function evaluateQuestionVisibility(question, answers = {}) {
  if (!question || !question.conditions || question.conditions.length === 0) {
    return true;
  }

  const logicType = question.condition_logic || 'AND'; // 'AND' or 'OR'

  const conditionResults = question.conditions.map((cond) => {
    if (!cond || !cond.depends_on) return true;

    const parentVal = answers[cond.depends_on];
    const op = cond.operator || '==';
    const targetVal = cond.value;

    const isParentEmpty =
      parentVal === undefined ||
      parentVal === null ||
      parentVal === '' ||
      (Array.isArray(parentVal) && parentVal.length === 0);

    // Empty / Not Empty operators
    if (op === 'is_empty') {
      return isParentEmpty;
    }
    if (op === 'is_not_empty') {
      return !isParentEmpty;
    }

    // If parent is empty and testing positive equality or comparison, it's not satisfied
    if (isParentEmpty) {
      return op === '!=';
    }

    // If parent value is an array (e.g. multiple_choice)
    if (Array.isArray(parentVal)) {
      const stringifiedArray = parentVal.map((v) => String(v).trim().toLowerCase());
      const targetStr = String(targetVal ?? '').trim().toLowerCase();
      const hasMatch = stringifiedArray.includes(targetStr);

      if (op === '==' || op === 'contains') return hasMatch;
      if (op === '!=') return !hasMatch;
      return hasMatch;
    }

    // String normalization for comparison
    const parentStr = String(parentVal).trim().toLowerCase();
    const targetStr = String(targetVal ?? '').trim().toLowerCase();

    if (op === '==') {
      return parentStr === targetStr;
    }
    if (op === '!=') {
      return parentStr !== targetStr;
    }
    if (op === 'contains') {
      return parentStr.includes(targetStr);
    }

    // Numeric comparisons
    const numParent = Number(parentVal);
    const numTarget = Number(targetVal);

    if (!isNaN(numParent) && !isNaN(numTarget)) {
      if (op === '>') return numParent > numTarget;
      if (op === '<') return numParent < numTarget;
      if (op === '>=') return numParent >= numTarget;
      if (op === '<=') return numParent <= numTarget;
    }

    return true;
  });

  if (logicType === 'OR') {
    return conditionResults.some(Boolean);
  }
  return conditionResults.every(Boolean);
}
