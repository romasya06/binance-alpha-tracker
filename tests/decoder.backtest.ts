import { decodeSetPoolStart } from '../src/decoder.js';
import { formatKyiv, formatLead } from '../src/utils/time.js';

const samples: Array<[string, string, number]> = [
  ['0x4d2281f0', '0x70e2af29ce7217a1091a273e0253557f03bde40386935bda4602ab8ab5c966ee664a3295000000000000000000000000000000000000000000000000000000006a0c5ed0', 1779195600],
  ['0x19622102', '0x70e2af2953f3eb1004dd92d9bc9fceb009a890d9f47261c929c215ce2e11cae2cbf177b2000000000000000000000000000000000000000000000000000000006a058100', 1778745600],
  ['0x1de7bbd4', '0x70e2af297cc59be0a3754a33144a091e7b62dbcbf1a7a6f8540f224f4798fb739fd742e90000000000000000000000000000000000000000000000000000000069fdb420', 1778234400],
  ['0x0f6596e5', '0x70e2af29c7bbacf97c1e5a1327a9298aabd300e55755bb2b4c36ddd7289b6ec4e560cb910000000000000000000000000000000000000000000000000000000069f843f0', 1777878000],
  ['0xc5788cb1', '0x70e2af29673dbd89b4de73f139ccca01f515536d386bc993c35efb3abf0a4d4b02b6dd200000000000000000000000000000000000000000000000000000000069f843f0', 1777878000],
  ['0xd5d1a5a3', '0x70e2af29673dbd89b4de73f139ccca01f515536d386bc993c35efb3abf0a4d4b02b6dd200000000000000000000000000000000000000000000000000000000069f86010', 1777885200],
  ['0x0a5b49c6', '0x70e2af290636066cec43597b2eb9e743a7c0e82c58c6bffaba22dae7bc5b012d37d6c7510000000000000000000000000000000000000000000000000000000069e758b0', 1776769200],
  ['0x4feb037d', '0x70e2af292a45d6e78af8531b026f2d50e2db238c2dbfdfbf5201eb0669b0fd5ac377d5450000000000000000000000000000000000000000000000000000000069dd0bf8', 1776094200],
  ['0x3f4470c8', '0x70e2af292a45d6e78af8531b026f2d50e2db238c2dbfdfbf5201eb0669b0fd5ac377d5450000000000000000000000000000000000000000000000000000000069de4860', 1776175200],
  ['0xff804089', '0x70e2af292a45d6e78af8531b026f2d50e2db238c2dbfdfbf5201eb0669b0fd5ac377d5450000000000000000000000000000000000000000000000000000000069dcccb0', 1776078000],
];

let pass = 0, fail = 0;
for (const [tx, input, expectedTs] of samples) {
  const d = decodeSetPoolStart(input);
  if (!d) { console.log(`FAIL ${tx}: decode returned null`); fail++; continue; }
  if (d.startTimestampSec !== expectedTs) {
    console.log(`FAIL ${tx}: got ${d.startTimestampSec}, want ${expectedTs}`);
    fail++; continue;
  }
  console.log(`OK   ${tx}  pool=${d.poolId.slice(0,10)}…${d.poolId.slice(-6)}  start=${formatKyiv(d.startTimestampSec)} Kyiv  (${formatLead(d.startTimestampSec)})`);
  pass++;
}
console.log(`\n${pass}/${pass+fail} passed`);

console.log('\nNegative tests:');
console.log('  empty input        →', decodeSetPoolStart(''));
console.log('  wrong selector     →', decodeSetPoolStart('0xdeadbeef' + '0'.repeat(128)));
console.log('  too short          →', decodeSetPoolStart('0x70e2af29'));
console.log('  timestamp = 0      →', decodeSetPoolStart('0x70e2af29' + '0'.repeat(128)));
