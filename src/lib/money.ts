/** Canonical money: integer IRR (one rial), never cents. Decimal inputs are
 * multiplied as rational integers; ties round up to the next rial. */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/** Exact presentation input; callers normalize localized digits first. */
export function moneyInputRial(value:string,unit:'rial'|'toman',allowZero=false){
 const input=value.trim(),toman=unit==='toman';
 if(!(toman?/^\d+(?:\.\d)?$/:/^\d+$/).test(input))throw new Error(toman?'مبلغ تومان باید صحیح یا دارای یک رقم اعشار باشد.':'مبلغ ریال باید صحیح باشد.');
 const [whole,fraction='0']=input.split('.'),exact=BigInt(whole)*BigInt(toman?10:1)+BigInt(toman?fraction:0);
 if(exact<ZERO||(!allowZero&&exact===ZERO)||exact>MAX)throw new Error('مبلغ خارج از محدودهٔ مجاز است.');return Number(exact);
}

export function rial(value: unknown, label = "مبلغ"): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) {
    throw new Error(`${label} باید عدد صحیح و نامنفی به ریال باشد.`);
  }
  const integer = BigInt(value);
  if (integer > MAX) throw new Error(`${label} از محدودهٔ مجاز بیشتر است.`);
  return Number(integer);
}

function decimal(value: number | string): [bigint, bigint] {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!match) throw new Error("تعداد یا نرخ باید نامنفی و دارای حداکثر شش رقم اعشار باشد.");
  const fraction = match[2] ?? "";
  return [BigInt(match[1] + fraction), BigInt(10) ** BigInt(fraction.length)];
}

function rounded(numerator: bigint, denominator: bigint): number {
  const value = (numerator * TWO + denominator) / (denominator * TWO);
  if (value < ZERO || value > MAX) throw new Error("جمع مبلغ از محدودهٔ مجاز بیشتر است.");
  return Number(value);
}

export function multiplyRial(amount: number, quantity: number | string): number {
  const [n, d] = decimal(quantity);
  return rounded(BigInt(rial(amount)) * n, d);
}

/** Quantity precision is an item property; the existing default remains six.
 * Return integer micro-units without multiplying an IEEE-754 fraction. */
export function quantityMicro(value: number|string, precision=6): number {
  if(!Number.isInteger(precision)||precision<0||precision>6)throw new Error('دقت تعداد باید بین صفر تا شش باشد.');
  const [n,d]=decimal(value),micro=n*(BigInt(1000000)/d);
  if(micro>MAX||micro%(BigInt(10)**BigInt(6-precision))!==ZERO)throw new Error('تعداد با دقت مجاز این کالا سازگار نیست.');
  return Number(micro);
}

/** A partial document receives a cumulative share of the original *extended*
 * integer amount. Differences of cumulative rounded shares conserve the total. */
export function cumulativeCostRial(unitCost:number,throughMicro:number):number {
  if(!Number.isSafeInteger(throughMicro)||throughMicro<0)throw new Error('تعداد تجمعی معتبر نیست.');
  return rounded(BigInt(rial(unitCost))*BigInt(throughMicro),BigInt(1000000));
}

/** A cumulative share of an exact carrying amount, not a rounded unit price. */
export function carryingShareRial(value:number,throughMicro:number,totalMicro:number):number {
  if(!Number.isSafeInteger(throughMicro)||!Number.isSafeInteger(totalMicro)||totalMicro<=0||throughMicro<0||throughMicro>totalMicro)throw new Error('سهم تعداد از موجودی مبنا بیشتر است.');
  return rounded(BigInt(rial(value))*BigInt(throughMicro),BigInt(totalMicro));
}

export function carryingUnitRial(value:number,qtyMicro:number):number {
  if(!Number.isSafeInteger(qtyMicro)||qtyMicro<=0)throw new Error('تعداد مبنای ارزش‌گذاری معتبر نیست.');
  return rounded(BigInt(rial(value))*BigInt(1000000),BigInt(qtyMicro));
}

export function percentRial(amount: number, percent: number | string): number {
  const [n, d] = decimal(percent);
  return rounded(BigInt(rial(amount)) * n, d * BigInt(100));
}

export function sumRial(values: readonly number[]): number {
  return rounded(values.reduce((sum, v) => sum + BigInt(rial(v)), ZERO), ONE);
}

export function roundRial(amount: number, step: number): number {
  const unit = BigInt(rial(step));
  if (unit < TWO) return rial(amount);
  const multiple = (BigInt(rial(amount)) * TWO + unit) / (unit * TWO);
  return sumRial([Number(multiple * unit)]);
}

/** Exact addition of quantities with six decimal places. Reject a result that
 * cannot round-trip through SQLite's numeric representation without loss. */
export function addQuantity(left: number, right: number): number {
  const scale = BigInt(1000000);
  const scaled = (value: number) => {
    const [n, d] = decimal(Math.abs(value));
    return n * (scale / d) * BigInt(value < 0 ? -1 : 1);
  };
  const total = scaled(left) + scaled(right);
  const absolute = total < ZERO ? -total : total;
  const value = Number(`${total < ZERO ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(6, "0")}`);
  if (!Number.isFinite(value) || scaled(value) !== total) throw new Error("تعداد از دقت قابل ذخیره‌سازی بیشتر است.");
  return value;
}

export function quantityValue(input: unknown, signed = false): number {
  if (typeof input !== "number" && typeof input !== "string") throw new Error("تعداد باید عدد معتبر باشد.");
  const text = String(input);
  const negative = text.startsWith("-");
  if (negative && !signed) throw new Error("تعداد نمی‌تواند منفی باشد.");
  const [numerator, denominator] = decimal(negative ? text.slice(1) : text);
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("تعداد از محدودهٔ مجاز بیشتر است.");
  const [actual, divisor] = decimal(Math.abs(value));
  if (actual * denominator !== numerator * divisor) throw new Error("تعداد بدون افت دقت قابل ذخیره‌سازی نیست.");
  return value;
}

export function weightedAverageRial(firstCost: number, firstQty: number, nextCost: number, nextQty: number): number {
  const [a, b] = decimal(firstQty);
  const [c, d] = decimal(nextQty);
  const quantity = a * d + c * b;
  if (quantity === ZERO) throw new Error("تعداد مبنای بهای میانگین باید بیشتر از صفر باشد.");
  return rounded(BigInt(rial(firstCost)) * a * d + BigInt(rial(nextCost)) * c * b, quantity);
}

export function adjustRialByPercent(amount: number, percent: number, direction: "up" | "down"): number {
  const [n, d] = decimal(percent);
  const base = BigInt(100) * d;
  if (direction === "down" && n > base) throw new Error("درصد کاهش قیمت نمی‌تواند از صد بیشتر باشد.");
  return rounded(BigInt(rial(amount)) * (direction === "up" ? base + n : base - n), base);
}
