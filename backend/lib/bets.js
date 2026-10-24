// Checks a bet sent by the app before it is stored.
//
// The app works out stake, books and payout itself (Entry, Single and Chart use the same formulas):
//   F500 mode: books and F500 are typed in.   stake = F500 x books,  payout = books x 500
//   Odds mode: stake and odds are typed in.   books = stake x odds / 50000,  payout = odds x stake / 100
// A purchase has all three values negative.
//
// The server recomputes the derived values from the typed ones, rejects a bet whose figures do not
// agree, and stores only the fields it knows (so a request cannot set e.g. `cancelled`).

const MAX_TEXT = 100;
const MAX_AMOUNT = 100000000;
const MAX_BOOKS = 100000;
const MAX_ODDS = 100000;
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const sameAmount = (a, b) => Math.abs(a - b) <= 0.01 + 1e-6 * Math.abs(b);

function text(value, name, errors) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_TEXT) {
    errors.push(`${name} is required (up to ${MAX_TEXT} characters)`);
    return '';
  }
  return value.trim();
}

function positiveInt(value, name, errors) {
  if (!Number.isInteger(value) || value < 1 || value > 10000) {
    errors.push(`${name} must be a whole number of 1 or more`);
  }
  return value;
}

function validateBet(body, now = Date.now()) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const bet = {
    meetingName: text(b.meetingName, 'meetingName', errors),
    raceNum: positiveInt(b.raceNum, 'raceNum', errors),
    horseNum: positiveInt(b.horseNum, 'horseNum', errors),
    horseName: text(b.horseName, 'horseName', errors),
    clientName: text(b.clientName, 'clientName', errors),
  };

  const betTime = new Date(b.betTime);
  if (Number.isNaN(betTime.getTime()) || betTime.getTime() > now + MAX_FUTURE_MS) {
    errors.push('betTime must be a valid date, not in the future');
  }
  bet.betTime = betTime;

  if (!isNumber(b.tax) || b.tax < 0 || b.tax > 100) {
    errors.push('tax must be a number from 0 to 100');
  }
  bet.tax = b.tax;

  if (b.clientRequestId !== undefined && b.clientRequestId !== null) {
    if (typeof b.clientRequestId !== 'string' || b.clientRequestId.length > 100) {
      errors.push('clientRequestId must be a short text');
    } else {
      bet.clientRequestId = b.clientRequestId;
    }
  }

  const hasF500 = b.f500 !== undefined && b.f500 !== null;
  const hasOdds = b.odds100 !== undefined && b.odds100 !== null;

  if (hasF500 === hasOdds) {
    errors.push('send either f500 or odds100');
  } else if (hasF500) {
    // F500 mode: books and f500 are the typed values
    if (!isNumber(b.f500) || b.f500 <= 0 || b.f500 > 1000) errors.push('f500 must be a number above 0');
    if (!isNumber(b.books) || b.books === 0 || Math.abs(b.books) > MAX_BOOKS) errors.push('books must be a non-zero number');

    if (errors.length === 0) {
      const stake = b.f500 * b.books;
      const payout = b.books * 500;
      if (!isNumber(b.stake) || !sameAmount(b.stake, stake)) errors.push('stake does not match F500 x books');
      if (!isNumber(b.payout) || !sameAmount(b.payout, payout)) errors.push('payout does not match books x 500');
      bet.f500 = b.f500;
      bet.books = b.books;
      bet.stake = stake;
      bet.payout = payout;
    }
  } else {
    // Odds mode: stake and odds100 are the typed values
    if (!isNumber(b.odds100) || b.odds100 <= 0 || b.odds100 > MAX_ODDS) errors.push('odds100 must be a number above 0');
    if (!isNumber(b.stake) || b.stake === 0 || Math.abs(b.stake) > MAX_AMOUNT) errors.push('stake must be a non-zero number');

    if (errors.length === 0) {
      const books = (b.stake * b.odds100) / 50000;
      const payout = (b.odds100 * b.stake) / 100;
      if (!isNumber(b.books) || !sameAmount(b.books, books)) errors.push('books does not match stake x odds / 50000');
      if (!isNumber(b.payout) || !sameAmount(b.payout, payout)) errors.push('payout does not match odds x stake / 100');
      bet.odds100 = b.odds100;
      bet.stake = b.stake;
      bet.books = books;
      bet.payout = payout;
    }
  }

  return errors.length > 0 ? { error: errors.join('; ') } : { value: bet };
}

module.exports = { validateBet };
