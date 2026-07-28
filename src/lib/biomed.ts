// Biomedical engineering — haemodynamics, biomechanics and biosignal sampling.
//
// THIS IS WHERE THE TWO HALVES OF THIS PRODUCT MEET. The life-science tools
// describe what a drug or an assay does; the engineering tools describe forces,
// flows and signals. Biomedical engineering is those same physics applied to a
// body, and the traps are the ones that come from forgetting the body is not a
// rigid pipe, a rigid lever, or a noiseless sensor.
//
// BLOOD IS NOT WATER AND VESSELS ARE NOT PIPES. Poiseuille's law is exact for
// steady laminar flow of a Newtonian fluid in a rigid straight tube, and
// circulation violates all four conditions: flow is pulsatile, blood is
// shear-thinning (its apparent viscosity falls as shear rate rises), vessels
// are elastic and dilate under pressure, and the arterial tree branches
// constantly. It remains the right first model because the FOURTH-POWER
// dependence on radius dominates everything else — a 20% narrowing of a vessel
// more than doubles its resistance, which is why a small plaque matters far
// more than intuition suggests — but every number here is an estimate whose
// error is measured in tens of percent, not percent.
//
// AN ALIASED SIGNAL CANNOT BE UNALIASED. Sampling is the one place in this
// module where the failure is not an inaccuracy but a permanent loss: once a
// frequency above half the sampling rate has folded down into the band, it is
// indistinguishable from a real signal at the folded frequency and NO amount of
// later filtering separates them. That is why the anti-alias filter has to be
// analogue and has to be before the converter, and why this module checks the
// sampling rate against the signal rather than only reporting the Nyquist
// frequency.
//
// UNITS: SI internally. Clinical pressures are usually in mmHg, which is
// converted where it appears, because a pressure in mmHg used as pascals is
// wrong by a factor of 133.

/** Pascals per mmHg. */
export const PA_PER_MMHG = 133.322;

export interface BiomedError {
  ok: false;
  error: string;
}

// ---------------------------------------------------------------------------
// Haemodynamics
// ---------------------------------------------------------------------------

export interface VesselInput {
  /** Internal radius, m. */
  radius: number;
  /** Length, m. */
  length: number;
  /** Volumetric flow, m^3/s. */
  flow: number;
  /** Dynamic viscosity, Pa*s. Whole blood is about 3.5e-3 at high shear. */
  viscosity: number;
  /** Density, kg/m^3. Blood is about 1060. */
  density: number;
}

export interface VesselResult {
  ok: true;
  /** Hydraulic resistance, Pa*s/m^3. */
  resistance: number;
  /** Pressure drop along the vessel, Pa, and in mmHg. */
  pressureDrop: number;
  pressureDropMmHg: number;
  /** Mean velocity, m/s. */
  velocity: number;
  reynolds: number;
  /** Wall shear stress, Pa. */
  wallShearStress: number;
  turbulent: boolean;
  notes: string[];
}

/**
 * Steady flow in a single vessel, by Poiseuille.
 *
 * THE FOURTH POWER IS THE WHOLE STORY. Resistance goes as 1/r^4, so a vessel
 * narrowed to 80% of its radius has 2.4 times the resistance and a vessel at
 * 50% has SIXTEEN times. This is why arteriolar tone controls blood pressure
 * with tiny changes in diameter, and why a stenosis that looks minor on an
 * image is not.
 *
 * WALL SHEAR STRESS IS A BIOLOGICAL SIGNAL, not just a mechanical quantity.
 * Endothelium senses it and remodels the vessel toward a set point of roughly
 * 1 to 2 Pa in arteries; regions of LOW or oscillating shear — outer walls of
 * bifurcations, the carotid sinus — are exactly where atherosclerotic plaque
 * forms preferentially. A shear stress well outside that band is worth noticing
 * rather than just reporting.
 */
export function vesselFlow(inp: VesselInput): VesselResult | BiomedError {
  const { radius, length, flow, viscosity, density } = inp;
  for (const [name, v] of [
    ["radius", radius],
    ["length", length],
    ["flow", flow],
    ["viscosity", viscosity],
    ["density", density],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (radius <= 0) return { ok: false, error: "The radius must be greater than zero." };
  if (length <= 0) return { ok: false, error: "The length must be greater than zero." };
  if (viscosity <= 0) return { ok: false, error: "The viscosity must be greater than zero." };
  if (density <= 0) return { ok: false, error: "The density must be greater than zero." };
  if (flow < 0) return { ok: false, error: "The flow cannot be negative." };

  const area = Math.PI * radius * radius;
  const resistance = (8 * viscosity * length) / (Math.PI * Math.pow(radius, 4));
  const pressureDrop = resistance * flow;
  const velocity = flow / area;
  const reynolds = (density * velocity * 2 * radius) / viscosity;
  // For Poiseuille flow the wall shear stress has a closed form.
  const wallShearStress = (4 * viscosity * flow) / (Math.PI * Math.pow(radius, 3));

  const notes: string[] = [];
  notes.push(
    "Resistance goes as 1/r^4, so narrowing a vessel to 80% of its radius multiplies its " +
      "resistance by 2.4 and narrowing to 50% multiplies it by 16. That fourth power is why " +
      "arterioles control blood pressure with tiny diameter changes, and why a stenosis that looks " +
      "modest on an image is not modest hydraulically.",
  );

  const turbulent = reynolds > 2300;
  if (turbulent) {
    notes.push(
      "The Reynolds number is above about 2300, so this flow is NOT laminar and Poiseuille's law " +
        "does not apply — the pressure drop will be substantially higher than computed here. In " +
        "circulation this happens in the ascending aorta at peak systole and downstream of a tight " +
        "stenosis, where it is audible as a bruit.",
    );
  }

  if (wallShearStress > 0) {
    if (wallShearStress < 0.4) {
      notes.push(
        `A wall shear stress of ${wallShearStress.toFixed(2)} Pa is LOW. Endothelium remodels toward ` +
          "roughly 1 to 2 Pa, and persistently low or oscillating shear is where atherosclerotic " +
          "plaque forms preferentially — outer walls of bifurcations, the carotid sinus.",
      );
    } else if (wallShearStress > 7) {
      notes.push(
        `A wall shear stress of ${wallShearStress.toFixed(2)} Pa is high. Sustained values above ` +
          "about 10 Pa are associated with endothelial damage and platelet activation, and above " +
          "roughly 100 Pa mechanical haemolysis becomes a concern — the practical limit in " +
          "designing blood-contacting devices.",
      );
    }
  }

  notes.push(
    "Poiseuille assumes STEADY LAMINAR flow of a NEWTONIAN fluid in a RIGID straight tube. " +
      "Circulation is pulsatile, blood is shear-thinning, and vessels are elastic — so treat this " +
      "as an estimate good to tens of percent, not a measurement.",
  );

  return {
    ok: true,
    resistance,
    pressureDrop,
    pressureDropMmHg: pressureDrop / PA_PER_MMHG,
    velocity,
    reynolds,
    wallShearStress,
    turbulent,
    notes,
  };
}

export interface CirculationInput {
  /** Mean arterial pressure, mmHg. */
  mapMmHg: number;
  /** Right atrial (central venous) pressure, mmHg. */
  cvpMmHg: number;
  /** Cardiac output, L/min. */
  cardiacOutputLmin: number;
  /** Heart rate, beats per minute. 0 to skip stroke volume. */
  heartRate?: number;
  /** Body surface area, m^2, for the cardiac index. 0 to skip. */
  bsa?: number;
}

export interface CirculationResult {
  ok: true;
  /** Systemic vascular resistance in SI, Pa*s/m^3. */
  svrSI: number;
  /** The same in the clinical unit, dyn*s/cm^5. */
  svrClinical: number;
  /** Stroke volume, mL; null without a heart rate. */
  strokeVolume: number | null;
  /** Cardiac index, L/min/m^2; null without a body surface area. */
  cardiacIndex: number | null;
  notes: string[];
}

/**
 * Systemic vascular resistance from the pressure difference and cardiac output.
 *
 * THIS IS OHM'S LAW, and the analogy is exact: pressure difference is voltage,
 * cardiac output is current, resistance is resistance. What it hides is that
 * resistance is not an independent variable — the body adjusts arteriolar tone
 * continuously to hold pressure, so a computed SVR is a snapshot of a
 * controlled system, not a property of the plumbing.
 *
 * THE DRIVING PRESSURE IS MAP MINUS CVP, not MAP. Using MAP alone overstates
 * the resistance by however large the venous pressure is, which is small in
 * health and very much not small in right heart failure — exactly the patient
 * in whom the number is being computed.
 */
export function circulation(inp: CirculationInput): CirculationResult | BiomedError {
  const { mapMmHg, cvpMmHg, cardiacOutputLmin } = inp;
  for (const [name, v] of [
    ["mean arterial pressure", mapMmHg],
    ["central venous pressure", cvpMmHg],
    ["cardiac output", cardiacOutputLmin],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (cardiacOutputLmin <= 0) return { ok: false, error: "The cardiac output must be greater than zero." };
  if (mapMmHg <= cvpMmHg) {
    return {
      ok: false,
      error:
        "The mean arterial pressure is at or below the central venous pressure, so there is no " +
        "pressure gradient to drive flow. Check the two values — this is not survivable as entered.",
    };
  }

  const dpPa = (mapMmHg - cvpMmHg) * PA_PER_MMHG;
  const qSI = cardiacOutputLmin / 1000 / 60; // L/min to m^3/s
  const svrSI = dpPa / qSI;
  // The clinical unit, dyn*s/cm^5. The universally used factor is 80, which is
  // itself ROUNDED — the exact conversion is 79.99 — so this and the SI value
  // agree to about 0.01% rather than exactly. Keeping 80 is right because it is
  // what every bedside monitor and textbook prints, but the two figures are not
  // the same number to full precision and it is worth knowing why.
  const svrClinical = (80 * (mapMmHg - cvpMmHg)) / cardiacOutputLmin;

  const notes: string[] = [];
  notes.push(
    "The driving pressure is MAP minus CVP, not MAP alone. Ignoring venous pressure overstates the " +
      "resistance by however large the CVP is — negligible in health, and very much not negligible " +
      "in right heart failure, which is exactly the patient this gets computed for.",
  );
  notes.push(
    "The clinical figure uses the conventional factor of 80, which is itself rounded from 79.99, " +
      "so it agrees with the SI resistance to about 0.01% rather than exactly. That is the " +
      "convention every monitor prints, not an error.",
  );
  notes.push(
    "This is Ohm's law with pressure for voltage and flow for current. The analogy is exact; what " +
      "it hides is that resistance is not independent — the body continuously adjusts arteriolar " +
      "tone to hold pressure, so this is a snapshot of a controlled system, not a fixed property.",
  );
  if (svrClinical < 700) {
    notes.push(
      `An SVR of ${svrClinical.toFixed(0)} dyn·s/cm⁵ is below the usual 800 to 1200 range — the ` +
        "vasodilated pattern seen in sepsis, liver failure and neurogenic shock.",
    );
  } else if (svrClinical > 1400) {
    notes.push(
      `An SVR of ${svrClinical.toFixed(0)} dyn·s/cm⁵ is above the usual 800 to 1200 range — the ` +
        "vasoconstricted pattern seen in cardiogenic and hypovolaemic shock.",
    );
  }

  let strokeVolume: number | null = null;
  if (inp.heartRate !== undefined && Number.isFinite(inp.heartRate) && inp.heartRate > 0) {
    strokeVolume = (cardiacOutputLmin * 1000) / inp.heartRate;
  }
  let cardiacIndex: number | null = null;
  if (inp.bsa !== undefined && Number.isFinite(inp.bsa) && inp.bsa > 0) {
    cardiacIndex = cardiacOutputLmin / inp.bsa;
    if (cardiacIndex < 2.2) {
      notes.push(
        `A cardiac index of ${cardiacIndex.toFixed(2)} L/min/m² is below 2.2, the conventional ` +
          "threshold for cardiogenic shock. Indexing to body surface area is what makes cardiac " +
          "output comparable between a 50 kg and a 100 kg patient.",
      );
    }
  }

  return { ok: true, svrSI, svrClinical, strokeVolume, cardiacIndex, notes };
}

// ---------------------------------------------------------------------------
// Biomechanics
// ---------------------------------------------------------------------------

export interface JointInput {
  /** External load, N. */
  load: number;
  /** Distance from the joint to the load, m. */
  loadArm: number;
  /** Distance from the joint to the muscle insertion, m. */
  muscleArm: number;
  /** Angle of muscle pull to the bone, degrees. 90 is perpendicular. */
  pullAngleDeg?: number;
  /** Weight of the segment itself, N. 0 to ignore. */
  segmentWeight?: number;
  /** Distance from the joint to the segment's centre of mass, m. */
  segmentArm?: number;
}

export interface JointResult {
  ok: true;
  /** External moment about the joint, N*m. */
  externalMoment: number;
  /** Muscle force required, N. */
  muscleForce: number;
  /** Mechanical advantage, muscle arm over load arm. */
  mechanicalAdvantage: number;
  /** Resultant joint reaction force, N. */
  jointReaction: number;
  notes: string[];
}

/**
 * Static equilibrium of a limb segment about a joint.
 *
 * THE HUMAN BODY IS BUILT ALMOST ENTIRELY FROM THIRD-CLASS LEVERS, which trade
 * force for speed and range: the muscle inserts very close to the joint, so its
 * moment arm is a small fraction of the load's, and it must therefore pull with
 * MANY TIMES the external load. A 100 N weight in the hand can need 700 N or
 * more from biceps — and every newton of that also presses the joint surfaces
 * together.
 *
 * THE JOINT REACTION FORCE IS THE NUMBER THAT MATTERS CLINICALLY, and it is
 * almost always larger than either the load or the muscle force alone, because
 * the muscle pulls the bones together while the load pulls them apart. It is
 * what a prosthesis has to survive and what an arthritic joint feels, and it is
 * routinely left out of a first analysis.
 *
 * A NON-PERPENDICULAR PULL WASTES FORCE. Only the component perpendicular to
 * the bone produces a moment; the rest compresses (or distracts) the joint. At
 * 20 degrees of pull only a third of the muscle force does any turning, which is
 * why moment arms and joint angles matter so much through a range of motion.
 */
export function jointStatics(inp: JointInput): JointResult | BiomedError {
  const { load, loadArm, muscleArm } = inp;
  for (const [name, v] of [
    ["load", load],
    ["load moment arm", loadArm],
    ["muscle moment arm", muscleArm],
  ] as [string, number][]) {
    if (!Number.isFinite(v)) return { ok: false, error: `The ${name} must be a finite number.` };
  }
  if (muscleArm <= 0) return { ok: false, error: "The muscle moment arm must be greater than zero." };
  if (loadArm < 0) return { ok: false, error: "The load moment arm cannot be negative." };
  if (load < 0) return { ok: false, error: "The load cannot be negative." };

  const segW = inp.segmentWeight ?? 0;
  const segArm = inp.segmentArm ?? 0;
  if (!Number.isFinite(segW) || segW < 0) return { ok: false, error: "The segment weight cannot be negative." };
  if (!Number.isFinite(segArm) || segArm < 0) return { ok: false, error: "The segment moment arm cannot be negative." };

  const angle = inp.pullAngleDeg ?? 90;
  if (!Number.isFinite(angle) || angle <= 0 || angle > 180) {
    return { ok: false, error: "The pull angle must be between 0 and 180 degrees." };
  }
  const sinA = Math.sin((angle * Math.PI) / 180);
  if (sinA <= 1e-9) {
    return {
      ok: false,
      error:
        "At this pull angle the muscle acts along the bone and produces NO moment at all, so no " +
        "finite muscle force can balance the load. Physiologically this is the position where a " +
        "muscle cannot act on that joint.",
    };
  }

  const externalMoment = load * loadArm + segW * segArm;
  const muscleForce = externalMoment / (muscleArm * sinA);
  const mechanicalAdvantage = muscleArm / (loadArm > 0 ? loadArm : muscleArm);

  // Joint reaction: the muscle pulls the segment toward the joint, the external
  // loads pull it away. Perpendicular and parallel components handled separately.
  const perp = muscleForce * sinA - load - segW;
  const along = muscleForce * Math.cos((angle * Math.PI) / 180);
  const jointReaction = Math.hypot(perp, along);

  const notes: string[] = [];
  if (mechanicalAdvantage < 1) {
    notes.push(
      `Mechanical advantage is ${mechanicalAdvantage.toFixed(3)} — well below 1, which is a ` +
        "THIRD-CLASS LEVER and is how almost every muscle in the body is arranged. It trades force " +
        "for speed and range of motion: the muscle must pull far harder than the load, but a small " +
        "muscle shortening moves the hand a long way, quickly.",
    );
  }
  if (load > 0 && muscleForce > 3 * load) {
    notes.push(
      `The muscle must produce ${(muscleForce / load).toFixed(1)} times the external load. That ` +
        "ratio is the direct consequence of the moment arms, and it is why the forces inside a " +
        "joint are far larger than anything acting on the body from outside.",
    );
  }
  notes.push(
    `The JOINT REACTION FORCE is ${jointReaction.toFixed(0)} N — larger than either the load or ` +
      "the muscle force acting alone, because the muscle presses the bones together while the load " +
      "pulls them apart. This is the number a prosthesis has to survive and the one an arthritic " +
      "joint feels, and it is the one most often left out.",
  );
  if (angle !== 90) {
    notes.push(
      `At a pull angle of ${angle} degrees only ${(sinA * 100).toFixed(0)}% of the muscle force ` +
        "produces a moment; the rest acts along the bone and simply compresses or distracts the " +
        "joint. That is why strength varies so much through a range of motion.",
    );
  }
  notes.push(
    "This is a STATIC analysis of a rigid segment with one muscle. Real joints are crossed by " +
      "several muscles acting together, the problem is indeterminate, and resolving it needs an " +
      "optimisation criterion or EMG rather than statics alone.",
  );

  return { ok: true, externalMoment, muscleForce, mechanicalAdvantage, jointReaction, notes };
}

// ---------------------------------------------------------------------------
// Biosignal sampling
// ---------------------------------------------------------------------------

export interface SamplingResult {
  ok: true;
  /** Nyquist frequency, half the sampling rate, Hz. */
  nyquist: number;
  adequate: boolean;
  /** Where an out-of-band component lands after folding, Hz; null when in band. */
  aliasedTo: number | null;
  /** Samples captured over the record. */
  samples: number | null;
  /** Frequency resolution of an FFT over that record, Hz. */
  resolution: number | null;
  notes: string[];
}

/**
 * Checks a sampling rate against the signal it is meant to capture.
 *
 * ALIASING IS IRREVERSIBLE, which is what makes this worth a tool rather than a
 * mental note. A component above the Nyquist frequency does not disappear — it
 * FOLDS DOWN and appears at |fs - f|, indistinguishable from a genuine signal
 * at that frequency. No filter applied after the converter can separate them,
 * because by then they are the same numbers. The anti-alias filter must be
 * analogue and must be before the sampler, always.
 *
 * NYQUIST IS A LOWER BOUND, NOT A DESIGN TARGET. Sampling at exactly twice the
 * highest frequency reconstructs a sine only with an ideal brick-wall
 * reconstruction filter and infinite record length; real acquisition uses three
 * to ten times, and a diagnostic ECG is sampled at 500 to 1000 Hz for a signal
 * whose content is largely under 100 Hz precisely so the QRS morphology survives.
 */
export function samplingCheck(
  sampleRateHz: number,
  signalMaxHz: number,
  recordSeconds?: number,
  interferenceHz?: number,
): SamplingResult | BiomedError {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    return { ok: false, error: "The sampling rate must be greater than zero." };
  }
  if (!Number.isFinite(signalMaxHz) || signalMaxHz <= 0) {
    return { ok: false, error: "The highest signal frequency must be greater than zero." };
  }

  const nyquist = sampleRateHz / 2;
  const adequate = signalMaxHz < nyquist;
  const notes: string[] = [];

  if (!adequate) {
    // Fold the offending frequency back into the band.
    let folded = Math.abs(signalMaxHz % sampleRateHz);
    if (folded > nyquist) folded = sampleRateHz - folded;
    notes.push(
      `UNDER-SAMPLED. The signal contains content at ${signalMaxHz} Hz, above the Nyquist ` +
        `frequency of ${nyquist} Hz, so it FOLDS DOWN and appears at ${folded.toFixed(2)} Hz — ` +
        "indistinguishable from a genuine component there. This is not recoverable: no filtering " +
        "after the converter can separate them, because by then they are the same numbers. The " +
        "anti-alias filter has to be ANALOGUE and has to be BEFORE the sampler.",
    );
    return {
      ok: true,
      nyquist,
      adequate: false,
      aliasedTo: folded,
      samples: recordSeconds ? Math.floor(recordSeconds * sampleRateHz) : null,
      resolution: recordSeconds ? 1 / recordSeconds : null,
      notes,
    };
  }

  const ratio = sampleRateHz / signalMaxHz;
  if (ratio < 3) {
    notes.push(
      `The sampling rate is only ${ratio.toFixed(2)} times the highest signal frequency. That ` +
        "satisfies Nyquist but is not a practical design: exact reconstruction at the limit needs " +
        "an ideal brick-wall filter and an infinite record. Real acquisition uses three to ten " +
        "times, which is why a diagnostic ECG runs at 500 to 1000 Hz for content mostly under " +
        "100 Hz — the QRS morphology has to survive, not just the frequency content.",
    );
  } else {
    notes.push(
      `The sampling rate is ${ratio.toFixed(1)} times the highest signal frequency, which is a ` +
        "sound margin — comfortably clear of the Nyquist limit and leaving room for a realisable " +
        "anti-alias filter with a finite transition band.",
    );
  }

  let aliasedTo: number | null = null;
  if (interferenceHz !== undefined && Number.isFinite(interferenceHz) && interferenceHz > 0) {
    if (interferenceHz > nyquist) {
      let folded = Math.abs(interferenceHz % sampleRateHz);
      if (folded > nyquist) folded = sampleRateHz - folded;
      aliasedTo = folded;
      notes.push(
        `Interference at ${interferenceHz} Hz is above Nyquist and will ALIAS to ${folded.toFixed(2)} ` +
          "Hz, landing inside the signal band where it cannot be told from real data. Mains " +
          "interference aliasing into the ECG band is the classic instance of this.",
      );
    } else {
      aliasedTo = interferenceHz;
      notes.push(
        `Interference at ${interferenceHz} Hz is below Nyquist, so it is sampled correctly and lands ` +
          "where it belongs. It can be removed afterwards with a notch filter — which is only " +
          "possible BECAUSE it was not aliased.",
      );
    }
  }

  let samples: number | null = null;
  let resolution: number | null = null;
  if (recordSeconds !== undefined && Number.isFinite(recordSeconds) && recordSeconds > 0) {
    samples = Math.floor(recordSeconds * sampleRateHz);
    resolution = 1 / recordSeconds;
    notes.push(
      `A ${recordSeconds} s record gives ${samples} samples and a frequency resolution of ` +
        `${resolution.toFixed(4)} Hz. Resolution depends ONLY on the record LENGTH, not on the ` +
        "sampling rate — sampling faster for the same duration buys bandwidth, not resolution, " +
        "which is the other half of the sampling trade nobody states.",
    );
  }

  return { ok: true, nyquist, adequate: true, aliasedTo, samples, resolution, notes };
}
