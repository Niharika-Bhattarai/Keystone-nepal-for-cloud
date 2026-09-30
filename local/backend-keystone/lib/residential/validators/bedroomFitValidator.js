'use strict';

const { boundingRectOf } = require('../../planGeometry');
const { buildRoomContract } = require('../roomContractBuilder');
const { canContractFitRect } = require('../contractGeometry');

function validateBedroomFit(room, brief = null) {
  const contract = room?.roomContract || buildRoomContract(room, brief);
  if (!contract || contract.contractType !== 'bedroom') return null;

  const bounds = boundingRectOf(room);
  if (canContractFitRect(room, bounds?.w, bounds?.h, brief)) return null;

  const bedType = String(contract.bedType || 'queen').toLowerCase();
  return `Bedroom fit invalid: ${room.id} cannot fit a ${bedType} bed with required clearances`;
}

module.exports = { validateBedroomFit };
