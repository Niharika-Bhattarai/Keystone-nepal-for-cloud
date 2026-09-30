'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {reserveRainChajjas}=require('../lib/nepal/rainChajja');
const {areaSqM}=require('../lib/nepal/areaLedger');

test('rain chajja stays inside sample parcel with 1 m working setbacks',()=>{
  const site=[0,0,11250,11250],footprint={slabs:[[1000,1000,10250,10250]]};
  const result=reserveRainChajjas(footprint,site);
  assert.equal(result.reservations.length,4);
  assert.equal(result.cornerReservations.length,4);
  const projected=[...result.reservations,...result.cornerReservations].map(r=>r.box);
  assert.ok(Math.abs(areaSqM(projected)-((9250+1220)**2-9250**2)/1e6)<1e-9);
  assert.equal(result.omitted.length,0);
  for(const reservation of result.reservations){
    assert.equal(reservation.depthMm,610);
    assert.equal(areaSqM([reservation.box],[site]),0);
    assert.equal(areaSqM([reservation.box],footprint.slabs),areaSqM([reservation.box]));
  }
});

test('rain chajja omits flush and too-narrow edges without crossing the plot',()=>{
  const site=[0,0,10000,10000],footprint={slabs:[[0,250,9750,9000]]};
  const result=reserveRainChajjas(footprint,site);
  assert.ok(result.omitted.some(item=>item.face==='west'));
  assert.ok(result.omitted.some(item=>item.face==='east'));
  assert.ok(result.omitted.some(item=>item.face==='south'));
  assert.ok(result.reservations.some(item=>item.face==='north'));
  assert.equal(result.cornerReservations.length,0);
});
