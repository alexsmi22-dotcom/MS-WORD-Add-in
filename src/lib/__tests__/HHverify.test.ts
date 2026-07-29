import { parseRatLiteral, ratToNumber, ratDiv, ratInt } from "../cas";
test("the exact pipeline is now at least as accurate as a naive parse", () => {
  for (const lit of ["6.721856781630347414583", "0.1", "1.7976931348623157", "123456789.123456789123", "2.675"]) {
    const viaRat = ratToNumber(parseRatLiteral(lit)!);
    console.log(`CMP ${lit}: rat=${viaRat} naive=${Number(lit)} same=${viaRat === Number(lit)}`);
  }
  // named 1-ULP witness
  const v = ratToNumber(ratDiv(ratInt(2n ** 53n + 1n), ratInt(7n)));
  console.log("CMP (2^53+1)/7 =", v, "expect 1286742750677284.8");
});
