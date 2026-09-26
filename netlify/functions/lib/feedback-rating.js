// BrickLink's feedback "rating" field is a plain integer code, not the
// word itself — confirmed against a real client library's source
// (funwithbots/go-bricklink-api, util/rating.go): its Rating type is an
// int with Praise=0/Neutral=1/Complaint=2, and has no MarshalJSON, so the
// wire value is the bare number. Shared between post-feedback.js (writing
// Ryan's own feedback) and order-status-check.js (reading a buyer's
// feedback back to display it in human words).
const RATING_CODES = { Praise: 0, Neutral: 1, Complaint: 2 };
const RATING_WORDS = { 0: 'Praise', 1: 'Neutral', 2: 'Complaint' };

module.exports = { RATING_CODES, RATING_WORDS };
