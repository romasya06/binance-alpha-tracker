import { decodeInitializePool } from '../src/decoders/initializePool.js';
import { decodeAddPoolOwners } from '../src/decoders/addPoolOwners.js';
import { decodeStringReturn, decodeUintReturn } from '../src/erc20.js';
import { formatKyiv } from '../src/utils/time.js';

let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`OK   ${name}`); pass++; }
  else { console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`); fail++; }
}

// --- Real tx: 0x84347eacfd58c83719052fd1fbc2365afdbba89335bbd0926c718e51c78bdfd0
// Pool init for QAIT
const initInput =
  '0x57c036db' +
  '0000000000000000000000004d41a5d412f4ef44a35b9f53b06db65ede249493' + // currency0 = QAIT
  '00000000000000000000000055d398326f99059ff775485246999027b3197955' + // currency1 = USDT
  '000000000000000000000000b0bb171d333569cfd28a37f5c5dddaaa90ad46af' + // [2]
  '000000000000000000000000a0ffb9c1ce1fe56963b0321b32e7a0302114058b' + // [3]
  '0000000000000000000000000000000000000000000000000000000000000064' + // fee = 100
  '0000000000000000000000000000000000000000000000000000000000010045' + // flags
  '000000000000000000000000000000000000000000000000000000006a183c50' + // ts = 1779973200
  '0000000000000000000000000000000000000c5a4714bc9e97514c43760bfd46';  // salt

const init = decodeInitializePool(initInput);
console.log('--- decodeInitializePool ---');
check('selector',  init?.selector,         '0x57c036db');
check('currency0', init?.currency0,        '0x4d41a5d412f4ef44a35b9f53b06db65ede249493');
check('currency1', init?.currency1,        '0x55d398326f99059ff775485246999027b3197955');
check('fee',       init?.fee,              100);
check('ts',        init?.startTimestampSec, 1779973200);
console.log(`     human start: ${init && formatKyiv(init.startTimestampSec)} Kyiv (expect: 28 May, 16:00 Kyiv = 21:00 Taipei)`);

console.log('\n--- decodeInitializePool negative ---');
check('empty',          decodeInitializePool(''), null);
check('wrong selector', decodeInitializePool('0xdeadbeef' + '0'.repeat(512)), null);
check('too short',      decodeInitializePool('0x57c036db'), null);

// --- Real tx: 0xe501182e703334ea2238b4cf77312f54c979b1ac982c4200f0db97b7f91d8a22
// addPoolOwners
const ownersInput =
  '0xfe7815ed' +
  'e563172fd97b8bf5b5aecde4dd5f06a83b55967664a220953a80057354e3de47' + // poolId
  '0000000000000000000000000000000000000000000000000000000000000040' + // offset
  '0000000000000000000000000000000000000000000000000000000000000001' + // len = 1
  '000000000000000000000000b220a1eb7f4fcf2ecf2f286624d6861a92874c51';  // owner

const own = decodeAddPoolOwners(ownersInput);
console.log('\n--- decodeAddPoolOwners ---');
check('selector', own?.selector, '0xfe7815ed');
check('poolId',   own?.poolId,   '0xe563172fd97b8bf5b5aecde4dd5f06a83b55967664a220953a80057354e3de47');
check('owners',   own?.owners,   ['0xb220a1eb7f4fcf2ecf2f286624d6861a92874c51']);

// --- ERC20 string decoder ---
console.log('\n--- decodeStringReturn ---');
// canonical ABI string "QAIT" (4 bytes)
const qaitAbi =
  '0x' +
  '0000000000000000000000000000000000000000000000000000000000000020' + // offset
  '0000000000000000000000000000000000000000000000000000000000000004' + // length = 4
  '5141495400000000000000000000000000000000000000000000000000000000';  // "QAIT" + padding
check('canonical "QAIT"', decodeStringReturn(qaitAbi), 'QAIT');

// bytes32-style "MKR" (old token style)
const mkrBytes32 = '0x4d4b520000000000000000000000000000000000000000000000000000000000';
check('bytes32 "MKR"', decodeStringReturn(mkrBytes32), 'MKR');

check('null', decodeStringReturn(null), null);
check('empty', decodeStringReturn('0x'), null);

console.log('\n--- decodeUintReturn ---');
check('18',   decodeUintReturn('0x0000000000000000000000000000000000000000000000000000000000000012'), 18);
check('0',    decodeUintReturn('0x0000000000000000000000000000000000000000000000000000000000000000'), 0);
check('null', decodeUintReturn(null), null);
check('huge', decodeUintReturn('0x0000000000000000000000000000000000000000000000000000000000000100'), null); // > 256

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
