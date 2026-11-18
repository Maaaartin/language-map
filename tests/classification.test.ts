import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClassification } from '../scripts/classification.js';
import { mapExactNames, parseGlottolog } from '../scripts/glottolog.js';

const tree = '#NEXUS\nBEGIN TREES;\ntree indo1319 = [&R] ((stan1293:1,afri1274:1)germ1287:1,(russ1263:1)slav1255:1)indo1319:1;\nEND;';
const csv = `ID,Name,Glottocode,ISO639P3code,Level,Latitude,Longitude,Countries,Family_ID,Language_ID,Is_Isolate
indo1319,Indo-European,indo1319,,family,,,,,,
germ1287,Germanic,germ1287,,family,,,,indo1319,,
slav1255,Slavic,slav1255,,family,,,,indo1319,,
stan1293,English,stan1293,eng,language,53,-1,GB,indo1319,,false
afri1274,Afrikaans,afri1274,afr,language,-31,20,ZA,indo1319,,false
russ1263,Russian,russ1263,rus,language,59,50,RU,indo1319,,false
dial1234,English dialect,dial1234,,dialect,,,,indo1319,stan1293,
basq1248,Basque,basq1248,eus,language,43,-1,ES,,,true
`;

test('Nexus classification parses hierarchy and rejects malformed trees and duplicate nodes', () => {
  const parents = parseClassification(tree);
  assert.equal(parents.get('stan1293'), 'germ1287');
  assert.equal(parents.get('germ1287'), 'indo1319');
  assert.equal(parents.get('indo1319'), null);
  assert.throws(() => parseClassification('<html>error</html>'), /Invalid/);
  assert.throws(() => parseClassification(tree.replace('afri1274', 'stan1293')), /duplicate/);
  assert.throws(() => parseClassification(tree.replace('germ1287:1,', 'germ1287:1),')), /Invalid|Unbalanced/);
  assert.throws(() => parseClassification(tree.replace(')indo1319:1;', ')indo1319:1')), /malformed|Invalid/);
});

test('exact matching adds source-backed families, subgroups, dialect ancestry, and isolate status', () => {
  const labels = ['English', 'Afrikaans', 'Russian', 'English dialect', 'Basque', 'english', 'Unknown'];
  const result = mapExactNames(labels.map(label => ({ id: label, label })), parseGlottolog(csv), parseClassification(tree));
  const english = result.matched.find(l => l.id === 'English')!;
  assert.equal(english.classification.family?.name, 'Indo-European');
  assert.equal(english.classification.branch?.name, 'Germanic');
  assert.deepEqual(english.classification.ancestors.map(a => a.name), ['Indo-European', 'Germanic']);
  assert.equal(result.matched.find(l => l.id === 'Russian')!.classification.branch?.name, 'Slavic');
  assert.equal(result.matched.find(l => l.id === 'English dialect')!.classification.branch?.name, 'Germanic');
  assert.equal(result.matched.find(l => l.id === 'Basque')!.classification.status, 'isolate');
  assert.ok(result.unmatched.every(l => l.classification === null));
  const fallback = mapExactNames([{ id: 'English', label: 'English' }], parseGlottolog(csv));
  assert.equal(fallback.matched[0].classification.family?.name, 'Indo-European');
  assert.equal(fallback.matched[0].classification.branch, null);
});
