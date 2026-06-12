// Central tuning for the whole experience.
export const CONFIG = {
  // --- flight model (m/s) ---
  cruiseSpeed: 24,
  boostSpeed: 66,
  hoverDrift: 0.35,        // gentle bob amplitude while hovering
  accelRate: 3.2,          // velocity spring toward desired (1/s)
  verticalSpeed: 14,
  yawSensitivity: 0.0022,
  pitchSensitivity: 0.0019,
  pitchLimit: Math.PI * 0.46, // ~83° up/down free look
  bankStrength: 1.35,      // roll per yaw-rate
  strafeBank: 0.45,        // lean into A/D strafes
  bankLimit: 0.9,

  // --- world ---
  groundClearance: 0.65,
  boundsSoftness: 0.06,

  // --- camera ---
  fovBase: 55,
  fovSpeedGain: 16,        // added at full cruise->boost
  fovBoostKick: 4,
  // ~30% closer than before; boost pulls back only ~half as far
  camHoverOffset: [0, 1.05, 2.8],
  camFlightOffset: [0, 1.55, 3.6],
  camBoostOffset: [0, 1.5, 4.0],
  camStiffness: 4.2,       // spring approach rate
  camLookAhead: 4.5,
  shakeBase: 0.0016,
  shakeSpeedGain: 0.011,
  shakeBoostBurst: 0.06,

  // --- character pose ---
  proneAngle: Math.PI * 0.46,  // how horizontal the body gets at speed
  poseBlendRate: 2.6,
};
