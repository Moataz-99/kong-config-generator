import { FIELD_INFO } from '../lib/fieldInfo.js';

// Small ⓘ next to a label; the description shows as a native hover tooltip.
export default function InfoIcon({ field, text }) {
  const desc = text || FIELD_INFO[field];
  if (!desc) return null;
  return <span className="info-icon" title={desc}>ⓘ</span>;
}
