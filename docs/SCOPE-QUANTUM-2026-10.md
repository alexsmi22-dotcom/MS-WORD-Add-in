# Quantum mathematics — scope (Release Q, 2026-10)

User directive 2026-10-23: "a comprehensive deep Quantum mathematics section … Dirac notation, superposition,
entanglement, interference, linear algebra … single-qubit gates, multi-qubit gates, quantum teleportation …" and
"Lunar Quantum Computing" — clarified as all three of: the linear algebra under quantum computing, LINEAR OPTICAL
quantum computing, and space/lunar quantum links.

Before this release: Quantum optics (4 tools in `quantum.ts`: two-qubit entanglement measures, CHSH/Bell, Werner
states, BB84 key rate); the math engine typesets Dirac notation (`ket(ψ)`, `bra(ψ)`, `braket(φ, ψ)`, `expval(A)` in
mathParse.ts) as real Word equations; `complexAlgebra.ts` has exact Gaussian rationals.

## Where it lives
Engineering groups, each its own panel next to Quantum optics: **Quantum computing** (Q1–Q3), **Quantum mechanics**
(Q6), and Quantum optics extended (Q4, Q5). Every tool follows the Release E contract (named outputs, the governing
formulas as Word equations in Dirac notation, tables as Word tables, a figure, unit contract declared).

## Arithmetic
States and operators are complex vectors/matrices in double precision, with EXACT DISPLAY of the common closed forms
(0, ±1, ±½, ±1/√2, ±√3/2, ±i/√2 … and e^{iπ/4} phases) recognised to 10⁻¹² and written as such in results — never a
silent rounding: a value that is not recognised is printed numerically. Global phase is stated, not dropped silently.
Sizes are capped (state vectors ≤ 10 qubits = 1024 amplitudes; boson sampling ≤ 8 photons) with named refusals.

## Parts
- **Q1 Linear algebra & Dirac notation** — parse kets/bras in Dirac form (`α|0⟩ + β|1⟩`, `|+⟩`, `|Φ⁺⟩`, `|01⟩`),
  inner/outer products, normalisation, operators (Pauli, H, user matrices), Hermitian/unitary/projector checks,
  eigen-decomposition (reuse linalg.ts), expectation values and variances, commutators/anticommutators, tensor
  (Kronecker) products, the Born rule for a measurement basis, the Robertson uncertainty relation.
- **Q2 Qubits, gates, circuits & protocols** — single-qubit gates (I, X, Y, Z, H, S, S†, T, T†, √X, Rx, Ry, Rz, phase,
  U(θ,φ,λ)), the Bloch sphere (state, rotation axis, figure), multi-qubit gates (CNOT, CZ, SWAP, iSWAP, Toffoli,
  Fredkin, controlled-U on any control/target), a circuit simulator on a typed circuit (≤ 10 qubits), the circuit
  diagram figure, measurement probabilities and post-measurement states; protocols as presets with the derivation shown:
  superposition and interference (H–Z–H, Mach–Zehnder phase), Bell-state preparation, quantum teleportation (the four
  outcomes and their corrections), superdense coding, Deutsch–Jozsa, Grover on 2–3 qubits, the quantum Fourier
  transform.
- **Q3 Entanglement & density matrices** — density matrix from a state or a mixture, purity, von Neumann entropy,
  partial trace and reduced states, Schmidt decomposition, concurrence and negativity (PPT), fidelity and trace
  distance, Bell states and the Bloch vector of a reduced qubit; reuse quantum.ts for what it already computes.
- **Q4 Linear optical quantum computing** — beam splitter and phase-shifter unitaries on modes, Mach–Zehnder
  interferometer transfer, Hong–Ou–Mandel interference (the dip), multiphoton output probabilities through a linear
  network via matrix permanents (boson sampling, ≤ 8 photons, exact Ryser), dual-rail qubits, KLM / linear-optics CZ
  success probabilities (1/9 post-selected, 1/16 heralded — cited), photon-loss effects.
- **Q5 Space & lunar quantum links** — free-space optical link budget for single photons: diffraction-limited beam
  (transmitter and receiver apertures, wavelength, range — Earth–Moon 3.844×10⁸ m and LEO/GEO presets), pointing,
  atmospheric and detector losses as inputs; photon arrival and coincidence rates for entanglement distribution (source
  pair rate, both arms' losses, coincidence window, accidentals); QKD secure key rate over the channel (reuse BB84 from
  quantum.ts; decoy-state if it can be cited); light-time delay. Constants: c exact; distances stated as presets with
  sources.
- **Q6 Quantum mechanics** — infinite and finite square well (levels, wavefunctions, figure), harmonic oscillator
  (levels, Hermite wavefunctions), hydrogen-like atom (levels, Rydberg formula, radial probability for small n,l),
  rectangular-barrier tunnelling (transmission vs energy), time evolution of a two-level system (Rabi oscillation)
  and of a superposition (e^{−iHt/ħ}), spin-½ in a magnetic field. CODATA 2018 constants (h, ħ, mₑ, e exact or
  recommended values, cited).

## Oracles
numpy (states, gates, density matrices, partial traces, permanents by brute force), scipy (expm, eigh), closed forms
(Born rule, HOM, levels), and the cited KLM probabilities. Every part pins a fixed case table computed by the
integrator before it is built.

## Out of scope (stated)
Noise channels beyond depolarising and amplitude damping; error-correcting codes beyond the 3-qubit bit flip; Hamiltonian
simulation of molecules; hardware-specific transpilation; QKD security proofs beyond the cited key-rate formulas;
anything needing vendor data.
