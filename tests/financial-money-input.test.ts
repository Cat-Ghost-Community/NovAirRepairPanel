import {describe,it} from 'node:test';import assert from 'node:assert/strict';import {moneyInputRial} from '../src/lib/money';
describe('exact financial input with explicit optional zero',()=>{
 it('accepts zero only when explicitly allowed for tax or unselected credit lines',()=>{assert.throws(()=>moneyInputRial('0','toman'));assert.equal(moneyInputRial('0','toman',true),0);assert.equal(moneyInputRial('0.0','toman',true),0);assert.equal(moneyInputRial('0','rial',true),0);});
 it('preserves integer rial precision and rejects sub-rial, negative and unsafe input',()=>{assert.equal(moneyInputRial('0.1','toman'),1);assert.equal(moneyInputRial('900719925474099.1','toman'),9007199254740991);assert.throws(()=>moneyInputRial('900719925474099.2','toman'));assert.throws(()=>moneyInputRial('0.01','toman',true));assert.throws(()=>moneyInputRial('-1','rial',true));assert.throws(()=>moneyInputRial('1.0','rial'));});
});
