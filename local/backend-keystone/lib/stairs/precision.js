'use strict';
const {TICKS_PER_FOOT}=require('./codeProfiles');
// Float-noise tolerance only, far smaller than a 1/64-inch detail tick. This
// does not permit rounding a dimension across a code boundary.
const NUMERIC_EPSILON_FT=1e-9;
function exactTicks(feet) {
  if(!Number.isFinite(feet)) throw new TypeError('Stair dimensions must be finite numbers in feet.');
  const ticks=feet*TICKS_PER_FOOT, rounded=Math.round(ticks);
  if(!Number.isSafeInteger(rounded) || Math.abs(ticks-rounded)>NUMERIC_EPSILON_FT*TICKS_PER_FOOT) {
    throw new RangeError('Dimension is not representable on the 1/64-inch datum grid.');
  }
  return rounded;
}
function uniformRiser(totalRiseTicks,risers) {
  if(!Number.isSafeInteger(totalRiseTicks)||totalRiseTicks<=0||!Number.isSafeInteger(risers)||risers<1) throw new TypeError('Positive exact rise and riser count are required.');
  return {numeratorTicks:totalRiseTicks,denominator:risers};
}
function rationalFeet(value) { return value.numeratorTicks/value.denominator/TICKS_PER_FOOT; }
function withinMaximum(value,limitTicks) {
  if(!Number.isSafeInteger(value.numeratorTicks)||value.numeratorTicks<0||!Number.isSafeInteger(value.denominator)||value.denominator<1||!Number.isSafeInteger(limitTicks)||limitTicks<0) throw new TypeError('Invalid rational dimension.');
  return BigInt(value.numeratorTicks)<=BigInt(limitTicks)*BigInt(value.denominator);
}
module.exports={NUMERIC_EPSILON_FT,exactTicks,uniformRiser,rationalFeet,withinMaximum};
