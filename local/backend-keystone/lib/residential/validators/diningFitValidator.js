'use strict';

const { boundingRectOf } = require('../../planGeometry');
const { buildRoomContract } = require('../roomContractBuilder');
const { canContractFitRect } = require('../contractGeometry');

function validateDiningFit(room, brief = null) {
  const contract = room?.roomContract || buildRoomContract(room, brief);
  if (!contract || contract.contractType !== 'dining') return null;

  const bounds = boundingRectOf(room);
  if (canContractFitRect(room, bounds?.w, bounds?.h, brief)) return null;

  const seatCount = Number(contract.seatCount) || 4;
  return `Dining fit invalid: ${room.id} cannot fit a ${seatCount}-seat table with circulation`;
}

module.exports = { validateDiningFit };
