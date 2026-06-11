// Central tuning for the whole experience.
export const CONFIG = {
  // --- flight model (m/s) ---
  cruiseSpeed: 11,
  boostSpeed: 30,
  hoverDrift: 0.35,        // gentle bob amplitude while hovering
  accel: 0.9,              // approach rate toward target speed (1/s)
  brakeAccel: 2.2,
  verticalSpeed: 6.5,
  yawSensitivity: 0.0021,
  pitchSensitivity: 0.0017,
  pitchLimit: Math.PI * 0.42,
  bankStrength: 1.35,      // roll per yaw-rate
  bankLimit: 0.85,

  // --- world ---
  groundClearance: 0.65,
  boundsSoftness: 0.06,

  // --- camera ---
  fovBase: 55,
  fovSpeedGain: 16,        // added at full cruise->boost
  fovBoostKick: 4,
  camHoverOffset: [0, 1.35, 3.9],
  camFlightOffset: [0, 1.05, 5.0],
  camBoostOffset: [0, 0.95, 5.5],
  camStiffness: 4.2,       // spring approach rate
  camLookAhead: 7,
  shakeBase: 0.0016,
  shakeSpeedGain: 0.011,
  shakeBoostBurst: 0.06,

  // --- character pose ---
  proneAngle: Math.PI * 0.46,  // how horizontal the body gets at speed
  poseBlendRate: 2.6,
};
