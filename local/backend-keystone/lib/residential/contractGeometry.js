'use strict';

const { buildRoomContract } = require('./roomContractBuilder');

const BED_GEOMETRIES = {
  twin: { widthFt: 3.25, lengthFt: 6.25 },
  full: { widthFt: 4.5, lengthFt: 6.25 },
  queen: { widthFt: 5, lengthFt: 7 },
  king: { widthFt: 6.33, lengthFt: 7 },
};

const DINING_TABLE_GEOMETRIES = {
  4: { widthFt: 3, depthFt: 3 },
  6: { widthFt: 5.5, depthFt: 3 },
  8: { widthFt: 8, depthFt: 4 },
};

function getContract(roomLike, brief = null) {
  return roomLike?.roomContract || buildRoomContract(roomLike, brief) || null;
}

function getContractFitOptions(roomLike, brief = null) {
  const contract = getContract(roomLike, brief);
  if (!contract?.contractType) return [];

  if (contract.contractType === 'bedroom') {
    const bedType = String(contract.bedType || 'queen').toLowerCase();
    const bed = BED_GEOMETRIES[bedType] || BED_GEOMETRIES.queen;
    const sideClearanceFt = Number(contract.sideClearanceFt || 2.5);
    const footClearanceFt = Number(contract.footClearanceFt || 2);

    return [
      {
        widthFt: bed.widthFt + (sideClearanceFt * 2),
        heightFt: bed.lengthFt + footClearanceFt,
      },
      {
        widthFt: bed.lengthFt + (sideClearanceFt * 2),
        heightFt: bed.widthFt + footClearanceFt,
      },
    ];
  }

  if (contract.contractType === 'dining') {
    const seatCount = Number(contract.seatCount) || 4;
    const table = DINING_TABLE_GEOMETRIES[seatCount] || DINING_TABLE_GEOMETRIES[4];
    const circulationFt = Number(contract.circulationClearanceFt || 3);

    return [
      {
        widthFt: table.widthFt + (circulationFt * 2),
        heightFt: table.depthFt + (circulationFt * 2),
      },
      {
        widthFt: table.depthFt + (circulationFt * 2),
        heightFt: table.widthFt + (circulationFt * 2),
      },
    ];
  }

  return [];
}

function canContractFitRect(roomLike, widthFt, heightFt, brief = null) {
  const options = getContractFitOptions(roomLike, brief);
  if (!options.length) return true;

  return options.some((option) =>
    Number(widthFt) >= Number(option.widthFt) &&
    Number(heightFt) >= Number(option.heightFt)
  );
}

function minimumDepthForFixedWidth(roomLike, widthFt, brief = null) {
  const options = getContractFitOptions(roomLike, brief);
  if (!options.length) return 0;

  const viable = options
    .filter((option) => Number(widthFt) >= Number(option.widthFt))
    .map((option) => Number(option.heightFt));

  return viable.length ? Math.min(...viable) : Infinity;
}

module.exports = {
  BED_GEOMETRIES,
  canContractFitRect,
  getContractFitOptions,
  minimumDepthForFixedWidth,
};
