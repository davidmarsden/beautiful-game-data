function expectationFromRank(rank, teamCount) {
  if (!rank || !teamCount) {
    return {
      category: "establish-baseline",
      summary: "Establish a competitive baseline.",
      sackRisk: "medium"
    };
  }

  const percentile = rank / teamCount;

  if (percentile <= 0.15) {
    return {
      category: "title-challenge",
      summary: "Compete for the title and qualify for elite competition.",
      sackRisk: "high"
    };
  }

  if (percentile <= 0.35) {
    return {
      category: "continental-places",
      summary: "Challenge for continental qualification.",
      sackRisk: "medium-high"
    };
  }

  if (percentile <= 0.7) {
    return {
      category: "top-half-stability",
      summary: "Build a stable top-half side.",
      sackRisk: "medium"
    };
  }

  return {
    category: "survival",
    summary: "Avoid relegation and stabilise the squad.",
    sackRisk: "medium-high"
  };
}

export function createManagerSlot({ club, standing, teamCount }) {
  const rank = standing?.rank ?? null;
  const boardExpectation = expectationFromRank(rank, teamCount);

  return {
    clubId: club.id,
    status: "vacant",
    controller: {
      type: "caretaker-ai",
      managerId: null,
      displayName: "Caretaker Manager"
    },
    permissions: {
      tactics: true,
      transfers: true,
      contracts: true,
      scouting: true,
      youth: true,
      media: true
    },
    caretaker: {
      active: true,
      reason: "no-human-manager-assigned"
    },
    boardExpectation,
    participation: {
      minimumActivity: "weekly",
      missedTurnTolerance: 2,
      handoverRequired: true
    },
    history: []
  };
}
