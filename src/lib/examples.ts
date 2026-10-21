// Per-mode "Examples & syntax" help content for the task pane's collapsible
// reference panel. Each mode shows only the examples relevant to it, so the help
// tracks the selected mode instead of being a fixed chemical/math/build list.
//
// Pure data (HTML strings) — no Office.js — so a unit test can assert that every
// mode has help content. The task pane swaps the active entry on mode change.

// The mode list lives in modes.ts as the single source of truth. Re-declaring it
// here is what let "spectra" ship without help content: the union was stale, and
// because Record<> only checks against the union, nothing complained.
export type { ExampleMode } from "./modes";
import type { ExampleMode } from "./modes";

/** HTML help fragment shown in the "Examples & syntax" panel for each mode. */
export const MODE_EXAMPLES: Record<ExampleMode, string> = {
  engineering: `
    <ul>
      <li><strong>Beam analysis</strong> &mdash; span, supports and loads in, reactions, shear and
        bending-moment diagrams out. Supports are <code>pin 0</code>, <code>roller 8</code> or
        <code>fixed 0</code>; loads go one per line:</li>
      <li><code>point 30 at 6</code> &mdash; a concentrated force, downward positive</li>
      <li><code>udl 5 from 0 to 8</code> &mdash; uniform intensity over part or all of the span</li>
      <li><code>udl 0 to 9 from 0 to 6</code> &mdash; linearly varying (triangular or trapezoidal)</li>
      <li><code>moment 200 at 4</code> &mdash; an applied couple, counterclockwise positive</li>
      <li><strong>Indeterminate beams work the same way</strong> &mdash; a propped cantilever
        (<code>fixed 0, roller 8</code>) or a fixed-fixed beam needs no special handling, and the
        reactions come out exact.</li>
      <li><strong>Elastic and settling supports</strong> &mdash; add <code>k=5e4</code> to put a
        support on a spring, or <code>settle=0.01</code> to push it down by a known amount
        (<code>roller 8 k=5e4</code>, <code>roller 8 settle=0.01</code>). Both need
        <code>EI</code>, and the tool says why: on rigid supports EI cancels out, but an elastic or
        displaced support makes the reactions genuinely depend on the beam's own stiffness, so
        there is no EI-free answer to give. On a <em>determinate</em> beam neither changes any
        reaction &mdash; the beam simply moves &mdash; and the engine reports that rather than
        leaving you to wonder. Using <strong>both on one support</strong> means the
        <em>seat</em> drops by the settlement and the spring then compresses on top of it
        (<code>v = &minus;settle &minus; R/k</code>) &mdash; a settling elastic foundation, not
        &ldquo;the beam ends up exactly that low whatever the spring does&rdquo;.</li>
      <li><strong>Fractions work in every field</strong> &mdash; <code>roller 8/3</code>,
        <code>point 30 at 8/3</code>, <code>udl 7/2 from 1/3 to 16/3</code>, and in the span and
        <code>EI</code> too. Since the engine computes over exact rationals, a support at
        <em>L</em>/3 typed as <code>2.6666666667</code> puts a rounding error into the input of an
        exact solver; typed as <code>8/3</code> the answer comes back exactly 20, not 19.99999999.</li>
      <li><strong>Deflection</strong> needs <code>EI</code>. On rigid supports, reactions, shear and
        moment do not, and are computed exactly without it.</li>
      <li><strong>Cross-section properties</strong> &mdash; area, second moment, section modulus,
        radius of gyration, and the peak bending and shear stress for a moment and shear you enter.
        A tee reports BOTH section moduli, because its fibres are at different distances.</li>
      <li><strong>Circuits</strong> &mdash; a SPICE-style netlist, one element per line:</li>
      <li><code>V1 1 0 5</code> &middot; <code>R1 1 2 1k</code> &middot; <code>R2 2 0 2k</code> &mdash; node <code>0</code> is ground</li>
      <li>Values may be written as a schematic prints them: <code>2k2</code> is 2.2 k, <code>4r7</code> is 4.7 ohms</li>
      <li>The <strong>DC operating point is exact</strong> &mdash; that divider reports <code>10/3 V</code>, not 3.3333</li>
      <li>Add <code>C</code> and <code>L</code> and give a start and stop frequency to sweep a node and draw a <strong>Bode magnitude plot</strong></li>
      <li><strong>Stress state</strong> &mdash; principal stresses, principal angle, Mohr's circle,
        von Mises and Tresca, and the factor of safety against a yield strength. It reports the
        <strong>absolute</strong> maximum shear as well as the in-plane one, and says when they
        differ &mdash; for a biaxial state the in-plane circle understates the shear the material
        actually sees, which is the classic way to be unconservative here.</li>
      <li><strong>Truss</strong> &mdash; the method of joints, one item per line:</li>
      <li><code>joint A 0 0</code> &middot; <code>member A B</code> &middot;
        <code>support A pin</code> &middot; <code>load C 0 -12</code></li>
      <li>Loads are vector components, so <strong>downward is negative</strong>, and member forces
        come back positive in tension. Reactions are <strong>exact</strong>. A mechanism, an
        indeterminate truss, and a critical form (the member count balances but the truss still
        collapses) are each named rather than given a confident wrong number.</li>
      <li><strong>Column buckling</strong> &mdash; Euler with the Johnson parabola for short
        columns, so a stocky column does not get quoted a critical load above yield that it can
        never reach. Give <code>I</code> about the <em>weak</em> axis.</li>
      <li><strong>Shaft torsion</strong> &mdash; polar second moment, peak shear, angle of twist.
        Circular sections only: <code>Tr/J</code> is a theorem for a circle and simply wrong for
        anything else.</li>
      <li><strong>Pipe flow</strong> &mdash; Reynolds number, friction factor from Colebrook-White
        (solved, not approximated), Darcy-Weisbach head loss, minor losses and pump power. The
        transition band 2300 &lt; Re &lt; 4000 returns a figure <em>and</em> says it is unreliable.</li>
      <li><strong>Composite wall or pipe insulation</strong> &mdash; a thermal resistance chain with
        every interface temperature, the controlling layer, and the <strong>critical radius</strong>:
        on a thin pipe, insulation below <code>k/h</code> makes the heat loss <em>worse</em>.</li>
      <li><strong>Heat exchanger</strong> &mdash; LMTD sizing, counter or parallel flow. A
        temperature cross is normal in counterflow and impossible in parallel flow, and it says so
        either way.</li>
      <li><strong>Control systems</strong> &mdash; enter a transfer function as coefficients
        highest power first (<code>1 3 2</code>) or written out (<code>s^2+3*s+2</code>):</li>
      <li><strong>Poles, zeros &amp; stability</strong> &mdash; with the <strong>exact</strong>
        Routh-Hurwitz array. Stability is decided TWICE, once exactly by Routh and once
        numerically from the poles; the two share no arithmetic, so agreeing is real evidence
        &mdash; and if they <em>disagree</em> the tool says so instead of picking one, because a
        disagreement means the system sits on the stability boundary.</li>
      <li><strong>Step &amp; impulse response</strong> &mdash; damping ratio, natural frequency,
        overshoot, rise, peak and settling time, with a plot. Exact identities for a genuine
        second-order system; above that they come from the dominant poles and it <em>says</em> so
        rather than presenting an estimate as a result.</li>
      <li><strong>Frequency response &amp; margins</strong> &mdash; Bode magnitude and phase with
        <strong>gain and phase margins</strong>. A margin that does not exist is reported as not
        existing: a first-order lag's phase never reaches &minus;180&deg;, so its gain margin is
        infinite and no finite number is correct.</li>
      <li><strong>PID &amp; closed loop</strong> &mdash; puts a controller in series, closes the
        loop, and reports the closed-loop poles, stability, margins and transient.</li>
      <li>A <strong>right-half-plane zero</strong> is called out as non-minimum-phase: the step
        response goes the <em>wrong way</em> first and more gain makes it worse.</li>
      <li><strong>Pharmacokinetics</strong> &mdash; built on <strong>clearance and volume</strong>,
        which are the physiologically independent parameters; half-life is a consequence of both
        (t&frac12; = ln2&middot;Vd/CL).</li>
      <li><strong>Dose &amp; concentration curve</strong> &mdash; IV bolus, infusion or oral, with
        Cmax, Tmax, AUC and a plot. AUC = Dose/CL, so total exposure is set by <em>clearance
        alone</em> and not by the volume of distribution.</li>
      <li><strong>Steady state &amp; loading dose</strong> &mdash; accumulation ratio, peak, trough
        and average. The average depends <em>only</em> on dose rate and clearance, so halving both
        the dose and the interval leaves it unchanged and only narrows the swing; the time to get
        there depends only on half-life, which is what a loading dose exists to bypass.</li>
      <li><strong>Non-compartmental analysis</strong> of measured data &mdash; paste
        <code>time concentration</code> pairs and get &lambda;z, half-life, AUC, clearance and
        volume. The terminal window is <strong>chosen</strong> by best adjusted R&sup2;, and the
        <strong>percentage of AUC that came from extrapolation</strong> is reported: above ~20% the
        study did not follow the drug long enough and every derived parameter is mostly assumption.</li>
      <li><strong>Flip-flop kinetics are detected.</strong> If absorption is slower than
        elimination, the terminal slope is <em>absorption</em>, not elimination &mdash; so a
        half-life read off the tail is the wrong one, and the curve looks entirely normal either
        way. Oral data also reports CL/F and Vz/F rather than pretending to know F.</li>
      <li><strong>Vibration</strong> &mdash; single- and multi-degree-of-freedom, built around the
        three results that are most often got wrong:</li>
      <li><strong>Resonance is not at r = 1.</strong> The magnification peaks at
        r = &radic;(1&minus;2&zeta;&sup2;), always <em>below</em> the natural frequency &mdash; and
        for &zeta; &ge; 0.707 there is <strong>no peak at all</strong> and no forcing frequency can
        resonate the system.</li>
      <li><strong>Isolation only begins above r = &radic;2.</strong> Transmissibility is exactly 1
        at &radic;2 for <em>every</em> damping ratio, and above 1 below it &mdash; so a mount that
        is not soft enough does not isolate a little, it <strong>amplifies</strong>.</li>
      <li><strong>Damping helps below &radic;2 and hurts above it.</strong> More damping lowers the
        resonant peak but <em>raises</em> transmissibility in the isolation region, because the
        damper is itself a path for force.</li>
      <li><strong>Free response &amp; damping</strong> &mdash; &omega;n, &zeta;, &omega;d,
        logarithmic decrement and a plot; each damping regime uses its own closed form (the
        critically damped case is not the underdamped one at &zeta; = 1, which divides by zero).
        Two measured peaks estimate &zeta; from a recorded trace, by the exact relation rather than
        the light-damping approximation.</li>
      <li><strong>Natural frequencies &amp; mode shapes</strong> &mdash; from a chain of masses and
        springs or from mass and stiffness matrices, solved as a symmetric generalised
        eigenproblem so the frequencies are guaranteed real. Mode shapes come back
        mass-normalised; a rigid-body (zero-frequency) mode is reported as the real feature it is,
        and a mass matrix that is not positive definite is refused as unphysical.</li>
      <li><strong>Multi-DOF forced response</strong> &mdash; steady-state amplitude and phase at
        every degree of freedom under a harmonic force, by modal superposition, with the modal
        breakdown showing which mode is actually carrying the response. <strong>Every</strong>
        natural frequency is a resonance, not just the first. A load applied at a <em>node</em> of a
        mode cannot excite that mode at all &mdash; a real design lever, and the reason a shaker in
        the wrong place can miss a mode entirely. Damping is entered as <strong>modal</strong>
        ratios (or Rayleigh &alpha;, &beta;) because modal superposition assumes CLASSICAL damping,
        which a single discrete damper between two floors does not satisfy; the tool states that
        rather than assuming it of a matrix you handed it.</li>
      <li><strong>Thermodynamics</strong> &mdash; ideal-gas processes, air-standard power cycles,
        and the Carnot limits that bound them.</li>
      <li><strong>TEMPERATURE IS ABSOLUTE</strong> in every formula, so you pick the unit you are
        typing and it converts before anything is divided. A Celsius value used as kelvin makes
        the Carnot bound between 500&nbsp;&deg;C and 20&nbsp;&deg;C read 96% instead of 62% &mdash;
        plausible, publishable and completely wrong. A temperature at or below absolute zero is
        refused rather than divided by.</li>
      <li><strong>Ideal-gas process</strong> &mdash; isothermal, isobaric, isochoric, isentropic
        and polytropic are one family (P&middot;V&#8319; = constant), so the work integral is
        derived once and cannot disagree between them; the n&nbsp;=&nbsp;1 singularity is written
        as its own limit rather than left to divide by zero.</li>
      <li><strong>Power cycles</strong> &mdash; Otto, Diesel and Brayton, each compared against
        the Carnot bound between its own extremes. At the <em>same</em> compression ratio Otto
        beats Diesel, and it says why Diesel wins anyway; Brayton efficiency depends only on
        pressure ratio, and the work-optimum ratio is not the efficiency-optimum one.</li>
      <li><strong>Rankine and refrigeration take enthalpies YOU look up.</strong> No steam tables
        are built in, deliberately &mdash; a table reconstructed from memory would be plausible and
        unverifiable, and this product's rule is that all data must be real. The tool does the
        cycle arithmetic and the energy-balance check on your own property data.</li>
      <li><strong>Carnot check</strong> &mdash; paste any claimed efficiency or COP and it says
        whether it is thermodynamically possible, and names the Celsius error when it is not.</li>
      <li><strong>Fatigue &amp; machine design</strong> &mdash; the corrected endurance limit by the
        Marin factor method, mean-stress criteria, finite life and cumulative damage. It consumes
        the stress state the stress tool produces and answers the next question: <em>will it
        survive 10&#8311; cycles?</em></li>
      <li><strong>Read every fatigue life as an order of magnitude.</strong> Identical specimens
        from the same bar differ by a factor of three routinely. Quoting a fatigue life to three
        significant figures is a category error, and every result here says so.</li>
      <li><strong>The endurance limit does not exist for most materials.</strong> Steel has a real
        knee in the S-N curve; aluminium, copper and magnesium <em>do not</em> &mdash; their curve
        keeps falling, so there is no stress with infinite life at all. Pick the material class and
        a non-ferrous one is told this rather than being handed a false "infinite".</li>
      <li><strong>Goodman alone can pass a part that yields on the first cycle.</strong> None of the
        fatigue criteria knows about static yield, so the Langer yield check runs alongside every
        one of them and the <em>governing</em> (smaller) factor of safety is reported. All four
        criteria are shown together, because they disagree by a lot.</li>
      <li>Compressive mean stress is treated as zero, not negative &mdash; it closes cracks and
        helps, which is why shot peening works, and feeding it in negative would overstate the
        benefit. <strong>Sut and Sy are asked for, not looked up:</strong> they move by a factor of
        three with heat treatment for the same alloy designation.</li>
      <li><strong>Op-amp circuits</strong> &mdash; the standard configurations plus the limits the
        ideal model hides. <strong>Bandwidth is the price of gain</strong>, and it is the
        <em>noise</em> gain that sets it, so a unity-gain inverting stage is half as fast as it
        looks. Slew rate is a separate large-signal limit whose full-power bandwidth is usually far
        below the small-signal one. An ideal integrator <em>saturates</em> without a DC feedback
        path &mdash; which is why the textbook 1/(sRC) never appears in a working schematic.</li>
      <li><strong>Analogue filter design</strong> &mdash; Butterworth or Chebyshev, low- or
        high-pass. It computes the <strong>minimum order</strong> from your specification, reports
        the attenuation actually delivered, compares what the other family would have needed, and
        hands you a <strong>transfer function</strong> you can take straight to the control tools.
        Look at the <em>phase</em> before committing: that is the half a magnitude plot hides.</li>
      <li><strong>Truth tables &amp; Boolean minimisation</strong> &mdash; any common notation
        (<code>A AND B</code>, <code>A&amp;B</code>, <code>AB</code>, <code>A*B</code>, trailing
        apostrophe for NOT). Minimisation is <strong>Quine-McCluskey</strong>, so it does not run
        out at five variables the way a Karnaugh map does; essential prime implicants are named,
        don't-cares are used with the risk stated, and when several minimal forms exist it says so.</li>
      <li><strong>Open-channel flow</strong> &mdash; Manning for rectangular, trapezoidal,
        triangular and part-full circular sections. <strong>The Froude number is the answer</strong>:
        it decides whether the channel is controlled from upstream or downstream, and crossing
        Fr&nbsp;=&nbsp;1 unintentionally gives a <strong>hydraulic jump</strong>.</li>
      <li><strong>Pump NPSH</strong> &mdash; cavitation is a <em>failure mode</em>, not an
        efficiency loss, and it is entirely a suction-side problem. NPSH available <em>falls</em> as
        the liquid gets hotter, which is what catches people out.</li>
      <li><strong>Compressible flow</strong> &mdash; isentropic relations with <strong>choking</strong>:
        past the critical pressure ratio (0.528 for air), lowering the downstream pressure does not
        increase the mass flow at all.</li>
      <li><strong>Haemodynamics</strong> &mdash; Poiseuille resistance, wall shear stress and
        systemic vascular resistance. <strong>The fourth power is the whole story</strong>: a 20%
        narrowing more than doubles resistance and halving the radius multiplies it by sixteen.</li>
      <li><strong>Joint biomechanics</strong> &mdash; the body is almost all third-class levers, so
        muscle force is many times the load &mdash; and the <strong>joint reaction force</strong> is
        larger than either, which is the number a prosthesis has to survive and the one usually
        left out.</li>
      <li><strong>Sampling &amp; aliasing</strong> &mdash; <strong>aliasing is irreversible</strong>.
        Once a frequency above Nyquist has folded into the band, no filtering afterwards can
        separate it from real data, which is why the anti-alias filter must be analogue and before
        the converter.</li>
      <li><strong>Levels &amp; references</strong> &mdash; a decibel is not a unit, so pick its
        reference: <code>4</code> dBu &rarr; dBFS under EBU R68 reads &minus;14 dBFS. dBFS needs an
        alignment, and dB SPL reaches volts only through a microphone sensitivity.</li>
      <li><strong>Level arithmetic</strong> &mdash; <code>80, 80, 74</code> sums to 83.52 dB, not
        234; a list may carry its reference (<code>0 dBu, 0 dBV</code> is converted first).
        Band lists take <code>1k</code> for 1000 Hz.</li>
      <li><strong>Timecode</strong> &mdash; <code>00:10:00;00</code> at 29.97 drop-frame is frame
        17982; <code>00:01:00;00</code> does not exist and is refused, with the labels either side.</li>
      <li><strong>Frame sizes and ratios</strong> &mdash; <code>1920&times;1080</code> or
        <code>1920x1080</code>; <code>4:3</code>, <code>10:11</code> or <code>2.39</code>.
        Shutter times take fractions: <code>1/125 s</code>, <code>1/48</code>.</li>
      <li><strong>Light &amp; camera</strong> &mdash; foot-candles <code>50 fc</code>, foot-lamberts
        <code>14 ftL</code> (never fL, the femtolitre), and f/5.6 counted as 5.657 in stop arithmetic.</li>
      <li>Units are whatever you type, used consistently &mdash; except the cross-section,
        buckling, torsion, pipe-flow and heat tools, which <strong>convert for you</strong>
        (<code>200 GPa</code>, <code>1e6 mm^4</code>, <code>50 ksi</code>, <code>68 &deg;F</code>)
        and refuse a unit of the wrong quantity rather than ignoring it. Beam and truss do not
        convert, because they compute over exact rationals and a conversion would destroy that.</li>
    </ul>
  `,
  chemical: `
    <ul>
      <li><code>H2O</code> &rarr; H<sub>2</sub>O</li>
      <li><code>Ca(OH)2</code> &rarr; Ca(OH)<sub>2</sub></li>
      <li><code>SO4^2-</code> &rarr; SO<sub>4</sub><sup>2&minus;</sup></li>
      <li><code>Na+</code> &rarr; Na<sup>+</sup></li>
      <li><code>CuSO4·5H2O</code> &rarr; CuSO<sub>4</sub>·5H<sub>2</sub>O (the hydrate coefficient stays full size; M = 249.677 g/mol); <code>CaSO4·0.5H2O</code> &rarr; M = 145.142 g/mol</li>
      <li>A reaction typed here is pointed to <strong>Reaction</strong> mode (Formulas) or Solve, where it is balanced.</li>
    </ul>
    <p class="examples-note">
      <strong>2D structures</strong> work from a common name
      (<code>aspirin</code>, <code>water</code>), a known formula
      (<code>C6H6</code>), or any <code>SMILES</code> string
      (<code>CC(=O)O</code>). For <strong>stereochemistry</strong>, enter an
      isomeric SMILES (<code>C[C@@H](N)C(=O)O</code>) — it's drawn with wedges.
    </p>`,

  math: `
    <ul>
      <li><code>x^2 + y^2</code> &rarr; x<sup>2</sup> + y<sup>2</sup></li>
      <li><code>a_n</code>, <code>x^{n+1}</code>, <code>sqrt(x)</code>, <code>pi</code></li>
      <li><code>(-b +- sqrt(b^2-4 a c))/(2 a)</code> — the quadratic formula</li>
      <li><code>sum</code>, <code>int</code>, <code>prod</code>, <code>lim</code>, <code>|x|</code>, <code>bar(x)</code></li>
      <li><code>matrix(a,b; c,d)</code>, <code>pmatrix(…)</code>, <code>cases(…)</code></li>
      <li><strong>Multi-line</strong>: <code>align(a = b; c = d)</code> (or paste a LaTeX <code>align</code> block)</li>
    </ul>
    <p class="examples-note">
      Tick <strong>native Word equation</strong> for true fractions/radicals, or
      add an optional <strong>number</strong> (I), (II), … The
      <strong>Formula library</strong> dropdown inserts ready-made expressions.
    </p>
    <p class="examples-note">
      <strong>Import / export LaTeX:</strong> paste LaTeX
      (<code>\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}</code>) to turn it into a Word
      equation, or copy the current formula out as LaTeX.
    </p>`,

  build: `
    <p class="examples-note">
      <strong>Build</strong> renders a structure from a typed atom/bond list or a
      pasted MDL molfile. Atom/bond example:
      <br /><code>atoms: C O O</code>
      <br /><code>bonds: 1=2 1=3</code> &rarr; CO<sub>2</sub>.
    </p>
    <p class="examples-note">
      Bonds: <code>-</code> single, <code>=</code> double, <code>#</code> triple,
      <code>~</code> undefined; stereo <code>&gt;</code> wedge / <code>&lt;</code> hash.
      Atoms can carry a charge (<code>N+</code>, <code>O-</code>); hydrogens fill
      automatically. <strong>Markush / generic:</strong> <code>[C,N]</code>
      variable atom, <code>X</code> halogen, <code>A</code> any atom,
      <code>Q</code> heteroatom, <code>R1</code> R-group. <strong>Query</strong>
      in a trailing <code>{…}</code>: <code>{ar}</code>, <code>{ring}</code>,
      <code>{r5}</code>/<code>{r6}</code>, <code>{sub}</code>/<code>{nosub}</code>.
    </p>
    <p class="examples-note">
      Define <strong>R-group legends</strong> (line or table), and use the
      <strong>substituent gallery</strong> to draw alternatives
      (<code>R1a = c1ccccc1</code>).
    </p>`,

  code: `
    <p class="examples-note">
      <strong>Algorithm</strong> style bolds control-flow keywords
      (<code>if</code>, <code>for</code>, <code>while</code>, <code>return</code>,
      …) and can number lines and show a caption
      (e.g. <em>Algorithm 1: KeyGen</em>). <strong>Code listing</strong> is
      verbatim monospace.
    </p>
    <pre class="examples-pre">function KeyGen(λ)
  sample sk ← ZZ_q
  pk ← g^sk mod p
  return (pk, sk)</pre>`,

  sequence: `
    <p class="examples-note">
      Add one or more sequences, set each <strong>molecule type</strong>
      (DNA/RNA/protein) and <strong>organism</strong>, then
      <strong>Generate ST.26 XML</strong> to download or copy.
    </p>
    <ul>
      <li>DNA: <code>ATGCAAAGCTAA</code></li>
      <li>Protein: <code>MKAILVVLLY</code></li>
    </ul>
    <p class="examples-note">
      Residues are cleaned automatically (whitespace/numbering stripped, case
      normalized, invalid characters flagged). <strong>Always validate the
      output in the WIPO Sequence tool before filing.</strong>
    </p>`,

  botanical: `
    <ul>
      <li><code>Rosa × hybrida 'Peace'</code> &rarr; <i>Rosa</i> × <i>hybrida</i> 'Peace'</li>
      <li><code>Quercus robur subsp. robur</code> &rarr; <i>Quercus robur</i> subsp. <i>robur</i></li>
    </ul>
    <p class="examples-note">
      Genus, species, and infraspecific epithets are italicized; rank connectors
      (<code>subsp.</code>/<code>var.</code>/<code>f.</code>), author citations,
      hybrid <code>×</code>, and cultivars (<code>'Peace'</code>) stay roman. The
      <strong>varietal characteristics</strong> table is built from
      <code>Label: value</code> lines.
    </p>`,

  numerals: `
    <p class="examples-note">
      Build a <strong>numeral → element</strong> table (saved in this document).
      <strong>Add numeral</strong> auto-suggests the next number (10, 12, 14 …);
      each row's <strong>Insert</strong> drops a callout at the cursor.
    </p>
    <ul>
      <li><code>housing</code> + <code>12</code> &rarr; housing (12)</li>
      <li>Untick <em>parenthesize</em> for <code>housing 12</code></li>
    </ul>
    <p class="examples-note">
      <strong>Scan document</strong> flags collisions (one numeral, two
      elements), gaps (skipped numbers), orphans (a callout with no entry), and
      unused entries. <strong>Insert List of Reference Numerals</strong> adds the
      sorted table. Detection looks for the parenthesized form, e.g.
      <code>(12)</code> — advisory; verify before filing.
    </p>`,

  dna: `
    <p class="examples-note">
      Paste a DNA/RNA sequence (IUPAC codes and whitespace are fine) for live
      analysis:
    </p>
    <ul>
      <li><strong>Reverse complement</strong> &amp; <strong>mRNA</strong> (transcription, T→U)</li>
      <li><strong>Translation</strong> — pick a reading frame (+1/+2/+3 or reverse −1/−2/−3); stop codons show as <code>*</code></li>
      <li><strong>Genetic code</strong> — all 27 NCBI tables (gc.prt 4.6): <code>ATGAGATGATGGTAA</code> under table 2 (Vertebrate Mitochondrial) → <code>M*WW*</code>, under the standard code <code>MR*W*</code>; the readout names the table and the codons that differ. Tables 27, 28 and 31 read their context-dependent stops as sense and say so.</li>
      <li><strong>GC content</strong> &amp; base composition / length</li>
      <li><strong>ORF finder</strong> — six frames, ATG → stop, with a minimum length filter; choose the genetic code and whether the table's alternative starts count (read as M): <code>GTGAAACCCGGGTAA</code>, table 11, alternative starts → <code>1..15 MKPG</code></li>
      <li><strong>Tools</strong> — primer Tm, protein MW/pI/GRAVY (of the translation), restriction sites</li>
    </ul>
    <p class="examples-note">
      Try <code>ATGGCCAAGCTTGATTAA</code>. Degenerate codons resolve when
      unambiguous (e.g. <code>GCN</code> → Ala). Drafting aid — verify downstream.
    </p>`,

  audit: `
    <p class="examples-note">
      <strong>Check this application</strong> reads the whole document and runs every
      consistency check at once:
    </p>
    <ul>
      <li>Reference numerals — collisions, gaps, orphans, unused (uses your Numerals table)</li>
      <li>Sequences — SEQ ID NO references vs. the listing</li>
      <li>Figures — referenced figure-number continuity</li>
    </ul>
    <p class="examples-note">Advisory — every check is heuristic; verify before filing.</p>`,

  reaction: `
    <p class="examples-note">
      A numbered reaction scheme, one item per line: a compound line, an arrow line
      (<code>-&gt; reagents ; conditions</code>), the next compound line.
    </p>
    <ul>
      <li><code>aspirin (1)</code> / <code>-&gt; NaOH, H2O ; 100 °C, 2 h</code> / <code>salicylic acid (2)</code> — numbers in bold under the structures, H₂O typeset.</li>
      <li>Number a compound with a space and its number in brackets: <code>(1)</code>, <code>(2a)</code>, <code>(S3)</code>, <code>(3′)</code>.</li>
      <li>The one-line form still works: <code>CCO + CC(=O)O &gt;&gt; CC(=O)OCC ; H2SO4 ; reflux</code>.</li>
      <li>Inserted numbers are kept by the document (<strong>Compounds in this document</strong>): a number reused for another structure, or a skipped one, is flagged; <strong>Number new compounds</strong> fills in the next free numbers; Characterization reads <code>compound 3</code>.</li>
      <li><strong>Conditions ▸ Lettered</strong> puts (a), (b) on the arrows and a "Reagents and conditions" footnote under the scheme; <strong>Scheme caption</strong> adds "Scheme N." above it.</li>
      <li>Each component is a name or SMILES (e.g. <code>aspirin</code>, <code>c1ccccc1</code>).</li>
      <li><strong>Read as Formulas</strong> to balance instead of draw: <code>Fe + O2 -&gt; Fe2O3</code> → 4 Fe + 3 O₂ → 2 Fe₂O₃, with the conservation table and chart; ions as <code>MnO4^-</code>, electrons as <code>e-</code>. <code>C + O2 -&gt; CO + CO2</code> is refused: 2 independent balancings, both shown. The reading is chosen, never guessed — <code>CO</code> is methanol as SMILES and carbon monoxide as a formula.</li>
    </ul>
    <p class="examples-note">Inserts as one picture at ChemDraw's size (alt text carries the scheme and its numbered SMILES) — verify before filing.</p>`,

  solve: `
    <p class="examples-note">
      Solve equations and basic calculus — offline, on your machine:
    </p>
    <ul>
      <li><strong>Solve an equation — with the work shown:</strong> <code>x^2 - 5x + 6 = 0</code> → the factoring ((x − 3)(x − 2) = 0, "a product is zero when a factor is zero") then x = 3, 2; <code>3x + 7 = 22</code> → collect, divide, x = 5; irrational cases show the quadratic formula with the numbers substituted. The worked lines insert into Word as real equations.</li>
      <li><strong>Exact cubic and quartic roots:</strong> <code>x^3 = 2</code> → <code>cbrt(2)</code> and <code>-1/2*cbrt(2) ± sqrt(3)/2*cbrt(2)*i</code>; <code>x^3 - 3x + 1 = 0</code> → <code>2*cos(2*pi/9)</code>, <code>2*cos(4*pi/9)</code>, <code>2*cos(8*pi/9)</code> (three real roots in the trigonometric form, never complex radicals); <code>x^4 - 10x^2 + 1 = 0</code> → ±sqrt(3) ± sqrt(2), denested; <code>x^4 + 4x - 1 = 0</code> by Ferrari over ℚ(√2). Each exact root is <strong>certified</strong> (an exact identity, then a numeric cross-check) and shows ≈ 12 digits beside it. Repeated roots come out once with their multiplicity — <code>(x-1)^4 = 0</code> → <code>1 (×4)</code> — and <code>x^3 + 3x^2 - 4 = 0</code> shows the work (x − 1)(x + 2)² = 0. Degree 5 and up is numerical, with Abel–Ruffini stated in general. Task words are read as the task: <code>solve x^2 - 5x + 6 = 0</code>, <code>find the roots of x^3 - 7x + 6</code>, <code>x^3 - 2 = 0 exactly</code>.</li>
      <li><strong>Simplify:</strong> <code>simplify (x^2 - y^2)/(x - y)</code> → <code>x + y</code>, naming the cancelled factor x − y and the points where the original is 0/0; <code>simplify (a^3 - b^3)/(a - b)</code> → a·b + a² + b²; <code>simplify cbrt(2)^3 - 2</code> → <strong>0</strong>, exactly. Past the caps (4 symbols, degree 12, 200 terms) it says so by name.</li>
      <li><strong>Systems:</strong> type several equations, one per line — <code>x + y = 3</code> / <code>x - y = 1</code> → x = 2, y = 1, exactly. It says whether there is one solution, none, or <strong>infinitely many</strong> (naming the free variables) rather than inventing a single answer.</li>
      <li><strong>Rearrange a formula:</strong> <code>F = m*a</code> → chips let you solve for <em>F</em>, <em>m</em> or <em>a</em>; picking <em>a</em> gives <code>a = F/m</code> with the condition <code>m ≠ 0</code>.</li>
      <li><strong>Solve with units:</strong> formula on the first line, knowns below — <code>F = m a</code> / <code>m = 3 kg</code> / <code>a = 2 m/s^2</code> → <strong>F = 6 N</strong> (kg·m/s²), the unit <strong>derived</strong>, conversions to SI reported (3 km → 3000 m), and mismatched dimensions <strong>refused by symbol and unit</strong> — adding metres to metres-per-second names exactly what went wrong.</li>
      <li><strong>Complex numbers:</strong> <code>i</code> is the imaginary unit — <code>(2+3i)(1-i)</code> → <strong>5 + i</strong>, exact; <code>(3+4i)/(1-2i)</code> → −1 + 2i; <code>abs(3+4i)</code> → 5; <code>arg(1+i)</code> → π/4; <code>sqrt(-4)</code> → 2i; <code>(1+i)^8</code> → 16. Every exact result is <strong>cross-checked</strong> against floating-point evaluation of the original. Equations too: <code>z^2 = 2i</code> → z = 1 + i, −1 − i, each root substituted back; <code>z^3 = i</code> → the three roots, labelled numeric.</li>
      <li><strong>Partial fractions:</strong> <code>partial fractions 1/(x^2-1)</code> → <code>1/2/(x - 1) - 1/2/(x + 1)</code>; <code>partial fractions 1/(x*(x+1)^2)</code> → the repeated factor gets both powers; an improper fraction shows its polynomial part first; quadratic factors over ℚ, repeated or distinct (<code>1/(x^4+4)</code>), keep linear numerators. The decomposition is <strong>recombined</strong> to confirm it equals the original.</li>
      <li><strong>Parametric systems:</strong> one extra letter in a linear system — <code>a x + y = 1</code> / <code>x - y = 2</code> — gives the solution <strong>for every value of a</strong> (x = 3/(a + 1), y = (−2a + 1)/(a + 1)) and lists the <strong>special values</strong>: a = −1 → no solution, the contradiction shown; where the system has infinitely many, the free variable is named.</li>
      <li><strong>Limits:</strong> <code>limit sin(x)/x as x -> 0</code> → 1; <code>limit abs(x)/x as x -> 0</code> → says the limit does <strong>not exist</strong> rather than picking a side.</li>
      <li><strong>Series:</strong> <code>taylor exp(x) order 5</code> → 1 + x + x²/2 + x³/6 + x⁴/24, exact fractions — now with the <strong>radius of convergence</strong>: <code>taylor 1/(1+x^2)</code> → R = 1, set by the complex poles ±i, the disc drawn. <code>radius of convergence of 1/(x^2 + 4) about 1</code> → R = sqrt(5); <code>interval of convergence of sum (x-3)^n/(n*2^n)</code> → [1, 5), each endpoint by a named test. R comes from a theorem (the nearest singularity, or the exact ratio test), never from the computed coefficients; <code>taylor abs(x)</code> says why it cannot.</li>
      <li><strong>Differentiate:</strong> <code>sin(x^2)</code> → <code>2*x*cos(x^2)</code>; <code>sin(x)*cos(x)</code> → <code>cos(x)^2 - sin(x)^2</code>.</li>
      <li><strong>Definite integral:</strong> <code>x^2</code> from 0 to 3 → 9, <strong>exact</strong>, showing F(x) = x³/3. Also <code>x*exp(x)</code>, <code>ln(x)</code>, <code>1/(x^2+4)</code> — by parts, substitution and partial fractions.</li>
      <li><strong>Laplace transforms:</strong> <code>laplace t^2 exp(3t)</code> → F(s) = 2/(s − 3)³ for s &gt; 3, each term's table rule shown and the result checked against the defining integral; <code>laplace t sin(t)</code>, <code>laplace sin(t)^2</code>, <code>laplace u(t-2)</code> (the unit step), <code>laplace delta(t-3)</code>. <code>inverse laplace 1/(s*(s+1))</code> → f(t) = 1 − e⁻ᵗ by partial fractions; <code>inverse laplace 1/(s^3+1)</code> keeps √3 exact; <code>inverse laplace exp(-2s)/s</code> → u(t − 2). Products, 1/t and exp(t²) are refused by name.</li>
      <li><strong>Initial-value problems (ODE kind):</strong> <code>y'' + 4y = sin(t), y(0) = 0, y'(0) = 0</code> → y = sin(t)/3 − sin(2t)/6 by Laplace transform, Y(s) shown, verified by substitution, the solution drawn; <code>y' + 2y = 1, y(0) = 0</code>; a step forcing <code>y'' + y = u(t-1), y(0) = 0, y'(0) = 0</code>.</li>
      <li><strong>Fourier series:</strong> <code>fourier series t^2 on (-pi, pi)</code> → a₀/2 = π²/3, aₙ = 4(−1)ⁿ/n², exact in n; <code>fourier series -1 on (-pi, 0); 1 on (0, pi)</code> (a square wave, by pieces) → bₙ = 4/(πn) for odd n, with the Gibbs caveat; <code>fourier series abs(t) on (-pi, pi)</code>; <code>fourier series exp(t) on (-1, 1)</code>; <code>fourier series cos(t) on (-pi, pi)</code> is its own series (no 0/0). The partial sum S₅ is drawn over f.</li>
      <li><strong>Multivariable calculus:</strong> <code>gradient x^2 y + y^3 at (1,2)</code> → ∇f = (2xy, x² + 3y²), ∇f(1,2) = (4, 13), each partial checked by central differences; <code>directional derivative x^2 y at (1,2) in direction (3,4)</code> → 16/5 (the direction normalised for you); <code>hessian x^3 + x y^2</code> and <code>jacobian (r cos(theta), r sin(theta))</code> → det J = r; <code>critical points x^3 - 3x + y^2</code> → (1, 0) local minimum, (−1, 0) saddle point, by exact elimination and the second-derivative test (<code>x^4 + y^4</code> is honestly <strong>inconclusive</strong>); <code>lagrange x y subject to x^2 + y^2 = 1</code> → ±1/2 at (±√2/2, ±√2/2), max and min declared because the circle is bounded; <code>double integral x^2 + y^2 over y from 0 to x, x from 0 to 1</code> → 1/3; <code>curl (y z, x z, x y)</code> → 0 and <code>potential (y z, x z, x y)</code> → φ = xyz + C; <code>line integral (2 x y, x^2) from (0,0) to (1,2)</code> → 2 (path-dependent fields are refused by name).</li>
      <li><strong>Linear programming:</strong> <code>maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0</code> → x = 4, y = 0, z = 12 by an exact two-phase simplex, the standard form with slacks, each constraint's slack and whether it binds, shadow prices (3, 0), reduced costs, objective and right-hand-side ranges, all verified by dual feasibility, complementary slackness and strong duality, the feasible region drawn with the objective contour; <code>minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x, y >= 0</code> (phase 1 stated); <code>dual of …</code>, <code>standard form of …</code>, <code>simplex tableau for …</code>, <code>graphically solve …</code>; <code>… x and y integer</code> → the LP relaxation, labelled, then branch-and-bound; unbounded → the ray, infeasible → the contradicting constraints, alternative optima → the edge; a missing <code>x, y >= 0</code> is never silently added — both answers are printed and labelled. One prose template (products × resources); transportation, assignment and diet in prose are refused by name with the typed form shown.</li>
      <li><strong>Interpolation and splines:</strong> <code>interpolate (1, 2), (2, 3), (4, 7)</code> → p(x) = 1/3·x² + 5/3, exact, Lagrange and Newton cross-checked, the curve drawn through the points; <code>… at x = 3</code> → 14/3; <code>newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)</code> → x³ with the table; <code>neville's method (0, 1), (1, 3), (2, 2) at x = 1.5</code> → 23/8 with the tableau; <code>linear interpolation between (1, 10) and (3, 20) at x = 2</code> → 15; <code>error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic</code>; <code>natural cubic spline through (0, 0), (1, 1), (2, 0)</code> → M = (0, −3, 0), one cubic per interval, continuity verified exactly; <code>clamped cubic spline through … with S'(0) = 1, S'(2) = -1</code>; <code>not-a-knot spline through …</code>; <code>pchip (0, 0), (1, 1), (2, 1), (3, 2)</code>. A least-squares <em>fit</em> is a different thing and is refused by name — use Sketch data → function or Stats regression.</li>
      <li><strong>Probability:</strong> <code>binomial n=10 p=0.4 P(X <= 3)</code> → 3733209/9765625 ≈ 0.382281, exact, with the pmf drawn and the event shaded; <code>poisson lambda = 2.5 P(X >= 3)</code>; <code>normal mean 100 sd 15 P(X > 120)</code> → z = 4/3, 1 − Φ(4/3) ≈ 0.0912, the tail shaded; <code>quantile normal 0.975</code> → 1.95996; <code>t 12 df P(T > 2.1)</code>, <code>critical value chi-square 3 df alpha 0.05</code> → 7.81473; <code>exponential rate 0.5 P(X > 3)</code>, <code>uniform(0, 10) variance</code> → 25/3, <code>beta(2, 5) mode</code> → 1/5; <code>hypergeometric N=50 K=5 n=10 P(X=1)</code>; <code>bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(A|B)</code> → 2/13 with the tree; <code>expected value of a fair die</code> → 7/2; <code>probability of at least one six in four rolls</code> → 671/1296; <code>confidence interval 95% mean 50 sd 10 n 30</code> (z and t, the choice stated); <code>markov [[0.9, 0.1], [0.5, 0.5]] stationary</code> → π = (5/6, 1/6), exact, the state diagram drawn; <code>absorbing markov chain [[1,0,0],[0.3,0.4,0.3],[0,0,1]] expected steps</code>. A proportion: <code>95% confidence interval for a proportion with 12 successes out of 40</code> → Wilson [0.180748, 0.4543] first, Clopper–Pearson [0.165627, 0.465316] (exact, conservative), Wald [0.157987, 0.442013] last — and at p̂ = 0 the zero-width Wald interval is called a failure, not printed as an answer. Hitting times: <code>markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] expected hitting time from 1 to 3</code> → 8, exact; <code>… probability of reaching 3 before 1 starting from 2</code> → 1/2; <code>… mean first passage time</code> → the whole matrix, its diagonal the return times; an unreachable target is ∞ with the closed class named.</li>
      <li><strong>Differential equations (symbolic):</strong> <code>y' = 2y</code> → y = C·e²ˣ with the separation worked; <code>y' = x - y</code> → the integrating-factor method, step by step; <code>y'' + 3y' + 2y = 0</code> → the characteristic equation and both exponentials; <code>y'' + 4y = 0</code> → cos + sin. Every solution is <strong>verified by substituting back</strong>, the three-member solution family is <strong>drawn</strong>, and anything outside the four supported families is refused by name. (Numeric/stiff initial-value problems live in Analyze → ODE solving.)</li>
      <li><strong>Geometry:</strong> <code>triangle 3 4 5</code>; <code>triangle a=6 b=8 A=30</code> (the ambiguous case — <strong>two</strong> answers); <code>triangle (0,0) (4,0) (0,3)</code> for centres; <code>circle r=3</code> → area <code>9π</code>; <code>x^2/9 + y^2/4 = 1</code> → classified as an ellipse with foci and eccentricity.</li>
      <li><strong>Composite figures:</strong> <code>rectangle 10in x 5in minus triangle b=4in h=3in</code> → the area <strong>with</strong> the triangle still counted (50 in²) and <strong>without</strong> it (44 in²), exact, with a drawn, labelled figure. Cutouts, additions (<code>plus</code>), mixed units converted exactly, π kept exact: <code>rectangle 8 x 6 minus circle r=2</code> → <code>48 − 4π</code>. Prose works too: “a rectangle 10&quot; x 5&quot; with a triangle inside, base 4&quot; height 3&quot;”.</li>
      <li><strong>Equation composer:</strong> the palette under the input builds equations by click — real symbols (<code>√</code>, <code>²</code>, <code>π</code>, <code>≤</code>), not spellings — and the <strong>equation library</strong> loads classics (<code>F = m a</code>, <code>PV = nRT</code>, Pythagoras…) ready to solve for any symbol. The input <strong>draws itself as real mathematics</strong> below the box while you type.</li>
      <li><strong>Equation canvas:</strong> <em>Open equation canvas ⤢</em> pops the composer into a large window — the equation drawn big as you build it, the <strong>solution live</strong> (roots, solve-for chips, derivative, integral with bounds), a <strong>graphing calculator</strong> (one curve per line; an equation graphs both sides so the crossings are the solutions; window under your control), a searchable equation library, and (for geometry) the composite figure drawn live.</li>
      <li><strong>Paste from anywhere:</strong> equations copied from papers, Word or the web just work — math-italic letters (𝑥), Greek variables (θ, λ — solvable symbolically), <strong>LaTeX</strong> (<code>\\frac{1}{x} + \\frac{1}{x+1} = 1</code>), the fraction slash and invisible characters are all read, and a note says exactly what was read.</li>
      <li><strong>Topology:</strong> <code>torus</code> → H₀ = Z, H₁ = Z², H₂ = Z; <code>projective plane</code> → <strong>H₁ = Z/2</strong> — real torsion, which a Betti number alone would lose; or give your own complex as <code>[0,1,2] [1,2,3]</code>.</li>
      <li><strong>Persistent homology:</strong> paste a <strong>point cloud</strong> (one point per line) into Topology → a <strong>barcode</strong> showing which holes in your data are real and which are noise. A ring shows one long H₁ bar; a blob shows none. Header lines above the points choose the field and scale: <code>over F3</code> (or <code>mod 3</code>, <code>coefficients Z/3</code>, <code>field 5</code> — any prime ≤ 46 337), <code>scale 2</code>, <code>H2</code>, and <code>compare</code>, which draws the 𝔽₂ and 𝔽₃ barcodes stacked: a long bar present over 𝔽₂ and missing over 𝔽₃ is reported as <strong>evidence of 2-torsion</strong> (universal coefficients) — the Klein bottle loses one, the torus none. When the complex would exceed 60 000 simplices the scale is lowered <em>before</em> building and bars still alive there are drawn <strong>censored</strong> (“≥ s”), never as infinite. <code>mod 4</code> is refused (not a field); an unrecognised line is printed, never silently skipped.</li>
      <li><strong>Homology over a field:</strong> <code>homology of klein bottle over z/3</code> → Betti numbers 1, 1, 0 over 𝔽₃ (and 1, 2, 1 over 𝔽₂), by universal coefficients from the integral result.</li>
      <li><strong>Real K-theory:</strong> <code>KO of S^1</code> → K̃O⁰(S¹) = ℤ/2 by Bott periodicity (any n — <code>KO of S^1000001</code> → ℤ/2); <code>KO of RP^9</code> → ℤ/32 (Adams 1962); <code>k-theory of s^1 x s^2</code> → K⁰ = ℤ², K¹ = ℤ². KO of a product, of ℂPⁿ, and graded KO of ℝPⁿ are refused by name.</li>
      <li><strong>Cobordism:</strong> <code>does rp^2 # rp^2 bound</code> → BOUNDS (every Stiefel–Whitney number vanishes); <code>signature of CP^2 # CP^2bar</code> → p₁ = 0, σ = 0, bounds in Ω₄ˢᴼ; <code>pontryagin numbers of CP^2 x CP^2</code> → p₂ = 9, p₁² = 18, σ = 1; <code>oriented cobordism group dimension 5</code> → ℤ/2, generated by the Wu manifold. The oriented verdict is given for dimension ≤ 8 only.</li>
      <li><strong>Knots:</strong> <code>knot trefoil</code> → the <strong>Jones polynomial</strong>; <code>braid 1 -2 1 -2</code> → the figure-eight. The two trefoils get different polynomials — chirality, which homology cannot see. Not a complete invariant, and it says so.</li>
      <li><strong>λ-calculus:</strong> <code>(λx.λy.x) y</code> → every β-step shown, the binder <strong>renamed to avoid capture</strong> (an α-step of its own) → <code>λy₁.y</code>; <code>PLUS 2 3</code> → the normal form, decoded as <strong>Church numeral 5</strong> and verified by an independent evaluator; <code>K I OMEGA</code> → <code>λx.x</code> in normal order, and <code>applicative K I OMEGA</code> → a <strong>proven divergence</strong> (the term cycles). <code>type λf.λx.f (f x)</code> → <code>(α → α) → α → α</code>; <code>type λx.x x</code> → not simply typable. <code>Y f</code> is capped and says the cap is not a theorem. Also <code>eta λx.f x</code> → f (βη-normal form), <code>ski λf.λx.f (f x)</code> → <code>S (S (K S) K) I</code> (bracket abstraction, verified by reducing both sides), <code>cl S K K x</code> → x by the combinator rules alone, Church lists (<code>SUM [1, 2, 3]</code> → 6, <code>MAP SUCC [1, 2]</code> → [2, 3]), and <code>let rec FACT = λn.IF (ISZERO n) 1 (MULT n (FACT (PRED n)))</code> / <code>FACT 3</code> → 6 through the Y combinator.</li>
      <li><strong>Computation theory:</strong> <code>S -> aSb | ε</code> then <code>test: aabb ab aab</code> → the CYK table, <code>S ⇒ aSb ⇒ aaSbb ⇒ aabb</code> and the parse tree drawn, cross-checked by brute force; <code>S -> S S | a</code> + <code>is it ambiguous</code> → two trees for aaa; <code>first and follow</code>; <code>remove left recursion</code>; <code>pda</code> blocks with the stack drawn and <code>cfg to pda</code> checked against CYK; <code>tm binary increment 1011</code> → 1100 with the tape drawn — LOOPS only when a configuration repeats, a cap is "UNKNOWN"; <code>prenex ∀x P(x) → ∃y Q(y)</code> → ∃x ∃y (P(x) → Q(y)); <code>unify f(x, g(x)) and f(a, y)</code> → {x ↦ a, y ↦ g(a)}; <code>resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)</code> → VALID with the refutation drawn; <code>dpll …</code>, <code>2sat …</code>, <code>horn …</code>, DIMACS; and in the λ kind <code>hm let id = λx.x in (id 1, id true)</code> → int × bool with id : ∀α. α → α.</li>
      <li><strong>Abstract algebra</strong> (Discrete math kind; typed into the Equation kind it switches there): <code>Z/6</code>, <code>U(8)</code>, <code>S3</code>, <code>D4</code>, <code>Z/2 x Z/4</code> or a typed Cayley table → elements, orders, generators, centre and the Cayley table <strong>drawn</strong> (axioms checked by brute force); <code>subgroup lattice of Z/12</code> → all six subgroups and the Hasse diagram; <code>cosets of &lt;3&gt; in Z/12</code>, <code>is A3 normal in S3</code>, <code>D4 / &lt;r^2&gt;</code> → ℤ/2ℤ × ℤ/2ℤ; <code>Z/6 ≅ Z/2 × Z/3</code> → isomorphic with the explicit CRT map (a “no” always names the invariant); <code>(1 2 3)(1 2)</code> → (1 3), composed right to left, with the cycle diagram; <code>7 * 9 mod 12</code> → 3; <code>factor x^4 + x^2 + 1 over F_2</code> → (x² + x + 1)²; <code>GF(9)</code> → 𝔽₃[x]/(x² + 1) with orders and primitive elements.</li>
      <li><strong>Balance a reaction</strong> (Equation kind): <code>Fe + O2 -&gt; Fe2O3</code> → 4 Fe + 3 O₂ → 2 Fe₂O₃; <code>KMnO4 + HCl -&gt; KCl + MnCl2 + Cl2 + H2O</code> → 2, 16, 2, 2, 5, 8; ions <code>MnO4^- + Fe^2+ + H^+ -&gt; Mn^2+ + Fe^3+ + H2O</code>; <code>half-reaction MnO4- -&gt; Mn2+ in acid</code> → MnO₄⁻ + 8 H⁺ + 5 e⁻ → Mn²⁺ + 4 H₂O, reduction (gains 5 e⁻); two half-reactions separated by <code>;</code> with <code>in acid</code>/<code>in base</code> are combined. Exact null space with a charge row, a conservation table and chart; <code>C + O2 -&gt; CO + CO2</code> is refused (2 independent balancings, both shown). Mass and charge conservation only.</li>
      <li><strong>Discrete math:</strong> twelve engines behind one kind, routed by what you type. <code>gcd 84 36</code> → 12 with Euclid's steps and Bézout coefficients; <code>7^100 mod 13</code> → 9 by square-and-multiply; <code>x ≡ 2 mod 3, x ≡ 3 mod 5, x ≡ 2 mod 7</code> → 23 (CRT); <code>factor 360</code> → 2³ × 3² × 5 with τ, σ, φ; <code>is 561 prime</code> → composite (a Carmichael number, caught by Miller–Rabin). <code>10 choose 3</code> → 120, <code>arrangements of MISSISSIPPI</code> → 34,650, <code>derangements 5</code> → 44, prose like “how many ways to choose 3 of 10”. <code>a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1</code> → Binet's formula, <strong>exact in ℚ(√5)</strong> and verified against iteration; <code>T(n) = 2T(n/2) + n</code> → Θ(n log n) by the master theorem. <code>(p -> q) & ~q -> ~p</code> → a tautology, with the table, DNF/CNF and the Quine–McCluskey minimal form; <code>p -> q, q |= p</code> → INVALID with the counterexample row. <code>regex (a|b)*abb</code> → the minimal DFA, <strong>drawn</strong>, with test strings run; an edge list with <code>shortest path A to F</code> on top → Dijkstra with the path highlighted in a drawn graph; <code>mst</code>, <code>eulerian</code>, <code>bipartite</code>, <code>topological order</code>.</li>
      <li><strong>Word problem:</strong> "12 is what percent of 48?", "twice a number plus 7 is 15".</li>
    </ul>
    <p class="examples-note">
      Built on a <strong>CAS core</strong> with exact rational arithmetic. Linear &amp; quadratic
      equations and formula rearrangement are <strong>exact</strong>; higher-degree polynomials
      return <strong>every</strong> root; transcendental ones give real roots
      <strong>numerically</strong> and say so. Every antiderivative is verified by
      differentiating it back — if it cannot be verified it is not offered. Word problems match a
      fixed set of templates and say so when they cannot parse — nothing is invented.
    </p>`,

  units: `
    <p class="examples-note">
      Typeset physical quantities and convert units:
    </p>
    <ul>
      <li><code>5.0 +- 0.2 kg</code> → 5.0 ± 0.2 kg</li>
      <li><code>9.81 m/s^2</code> → 9.81 m/s²</li>
      <li><code>1.2e-3 mol/L</code> → 1.2 × 10⁻³ mol/L</li>
      <li>Symbols: <code>ohm</code> → Ω, <code>degC</code> → °C, <code>umol</code> → µmol</li>
    </ul>
    <p class="examples-note">
      <strong>Convert</strong> handles length, mass, time, temperature, volume,
      pressure, energy, amount, and angle (e.g. <code>1 km → mi</code>,
      <code>100 °C → °F</code>) — including <strong>compound units</strong>
      (<code>km/h → m/s</code>, <code>g/mol → kg/mol</code>).
    </p>`,

  refs: `
    <p class="examples-note">
      Auto-numbered captions and cross-references; counters are saved in the document.
    </p>
    <ul>
      <li><strong>Insert caption</strong> → "Figure 1. …", "Table 2. …" (number auto-increments).</li>
      <li><strong>Cross-reference</strong> → "Fig. 3", "Table 2", or "Eq. (1)".</li>
      <li><strong>Check captions</strong> flags skipped or duplicated figure/table numbers.</li>
    </ul>
    <p class="examples-note">
      For live auto-renumbering across a long document, Word's own cross-reference
      fields remain the authority; this is the lightweight authoring aid.
    </p>`,

  plot: `
    <p class="examples-note">
      Plot a function or data as a chart (inserted as an image; runs offline).
    </p>
    <ul>
      <li><strong>Function:</strong> <code>sin(x)/x</code>, <code>x^2</code>, <code>exp(-x^2)</code> over an x-range.</li>
      <li><strong>Data:</strong> one point per line — <code>x y</code> or <code>x y err</code> (error bars).</li>
      <li>Functions: sin, cos, tan, exp, log/ln, sqrt, abs, …; constants pi, e.</li>
    </ul>
    <p class="examples-note">Optional title and axis labels. You can plot a function and data together.</p>`,

  ppt: `
    <p class="examples-note">
      Turn a Word <strong>table</strong> into a graphic: insert it into the document as a
      <strong>figure</strong> — including a black-&amp;-white <strong>patent figure</strong>
      style — or export it to <strong>PowerPoint</strong> (.pptx download).
    </p>
    <ul>
      <li>Click anywhere <strong>inside the table</strong> in your document, then <em>Read selected table</em>.</li>
      <li><strong>Charts</strong> (numeric tables): column, bar, line, area, pie, doughnut.
        First column = category labels; first row = series names (if it's text). Numbers may
        include <code>$</code>, <code>%</code>, commas, units (<code>12 kg</code>), and <code>(1,200)</code> negatives.</li>
      <li><strong>Flowchart</strong> (text tables): each row is a step, drawn top-to-bottom with
        arrows. A first column like <code>S101</code> becomes the step's reference numeral; a step
        ending in <code>?</code> is drawn as a decision diamond; Start/End rows get rounded boxes.</li>
      <li><strong>Block diagram</strong>: each row is a path — e.g. <code>System | Subsystem | Component</code> —
        merged into connected boxes. Leave a cell blank to repeat the value above it.</li>
      <li><strong>Table figure</strong>: draws the table <em>itself</em> as a clean figure — for
        characteristics/reference tables where the table is the exhibit. Keeps section grouping
        (a group-header row becomes a band; a blank “section” column merges down), bolds the header.</li>
      <li><strong>Patent style</strong> — pure black-&amp;-white line art: hatched bars/slices, dashed
        lines with distinct markers, and an optional <code>FIG. 1</code> label (37 CFR 1.84-friendly).</li>
      <li><strong>Reference numerals</strong> — number figure elements for callouts, drawn with
        <strong>lead lines</strong> to each element (37 CFR 1.84(q)): block-diagram boxes get
        hierarchical numbers (100, 110, 112…), flowchart steps 102, 104… (alternating sides), and
        table rows/sections get margin numerals with lead lines. Auto-placed as a starting point —
        reposition them as your drawing needs.</li>
    </ul>
    <p class="examples-note">
      When you read a table, the tool <strong>auto-picks</strong> the best view (chart, flowchart,
      block diagram, or table figure) — change it any time in “Show as”. Figures insert as images;
      use <strong>Insert as editable Word table</strong> (or tick <em>Also insert the data…</em>) when
      you need the text to stay editable. The PowerPoint chart is native and fully editable.</p>`,

  citations: `
    <p class="examples-note">
      Format <strong>Bluebook</strong> legal citations from labeled fields — the correct
      italics (case names, article/book titles, signals) are applied on insert.
    </p>
    <ul>
      <li><strong>Cases</strong> — <em>Alice Corp. v. CLS Bank Int'l</em>, 573 U.S. 208, 216 (2014); short form uses <code>at</code> (or <em>“→ Short form of this case”</em>). Type full party names — <em>Tables T6 &amp; T10</em> auto-abbreviate them (Corporation → Corp., International → Int’l, California → Cal.).</li>
      <li><strong>Id. / supra</strong> — <em>Id.</em> at 217 for the immediately preceding cite (or <em>“Insert Id. for the preceding authority”</em>, which scans above the cursor); <em>supra</em> note 15, at 912 for an earlier source (<em>“Detect earlier source”</em> finds a prior law-review article and fills the author).</li>
      <li><strong>Statutes / regs</strong> — 35 U.S.C. § 101; 37 C.F.R. § 1.84 (multiple sections auto-use §§).</li>
      <li><strong>Patents</strong> — U.S. Patent No. 10,123,456; App. Pub. No. 2020/0123456 A1 (numbers auto-grouped).</li>
      <li><strong>Agency &amp; secondary</strong> — Fed. Reg., MPEP §, law-review articles, and treatises.</li>
      <li><strong>Signals</strong> — optional italicized <em>See</em>, <em>Cf.</em>, <em>But see</em>, … prepended.</li>
      <li><strong>Paste &amp; fix</strong> — paste a messy citation (<code>35 usc 101</code>, <code>alice corp v cls bank, 573 us 208 (2014)</code>) and it detects the type and fills the fields to review.</li>
      <li><strong>Table of Authorities</strong> — scan the document and insert a grouped, alphabetized authorities list (cases, statutes, regs, patents, other); add page numbers before filing.</li>
      <li><strong>Bibliography</strong> — paste or open BibTeX, RIS or CSL-JSON, pick <em>IEEE, ACS, Nature, Vancouver, APA 7</em> or <em>Chicago</em>, and <em>Insert citation</em>: <code>[1, p. 1842]</code>, <code>(Kwon, 2022, p. 1842)</code>, <code>(Kwon 2022, 1842)</code>. After moving or deleting one, <em>Update numbering &amp; bibliography</em> renumbers every citation and rewrites the reference list. A pasted DOI (<code>doi:10.1086/720277</code>) is recognised but never looked up — JurisLab works offline.</li>
    </ul>
    <p class="examples-note">
      Pick a <strong>Style</strong> — <em>Practitioner</em> (briefs/office actions) or <em>Academic</em>
      (law-review footnotes); they differ in case-name italics and small-caps for authors/journals.
      Reporters and courts auto-correct (<code>f3d</code>→F.3d, <code>fed cir</code>→Fed. Cir.).
      Dates like <code>2014-06-19</code> or <code>3/1/2020</code> become Bluebook month form.
      Drafting aid — <strong>verify against the current Bluebook</strong>; this applies common
      conventions, not the full manual.</p>`,

  finance: `
    <p class="examples-note">
      Financial <strong>calculators</strong> — pick one, fill the inputs, and the result
      computes live; insert it at the cursor.
    </p>
    <ul>
      <li>Time value of money — future/present value, compound interest, loan payment</li>
      <li>Discounted cash flow — <strong>NPV</strong> and <strong>IRR</strong> from a cash-flow list</li>
      <li><strong>Black–Scholes</strong> option price; <strong>bond</strong> pricing</li>
    </ul>
    <p class="examples-note">
      Rates are entered as percentages. For the matching typeset equations, see the
      <strong>Finance</strong> categories in the Math <em>Formula library</em>.
    </p>`,
  assay: `
    <p class="examples-note">
      Quantitative <strong>assay</strong> tools — pick a calculator, paste your data, and the
      fit or result computes live on your machine; insert the result (and the fitted plot).
    </p>
    <ul>
      <li><strong>Enzyme kinetics</strong> — Michaelis–Menten &amp; Hill fits (V<sub>max</sub>, K<sub>m</sub>, n) with standard errors and R²</li>
      <li><strong>Dose–response</strong> — 4-parameter logistic → <strong>IC50 / EC50</strong>, Hill slope, pEC50; Cheng–Prusoff K<sub>i</sub></li>
      <li><strong>Binding</strong> — one-site saturation (B<sub>max</sub>, K<sub>d</sub>)</li>
      <li><strong>Lab math</strong> — Henderson–Hasselbalch, Beer–Lambert, dilutions, A260/A280 quantitation</li>
      <li><strong>Reaction stoichiometry &amp; yield</strong> — <code>2 H2 + O2 -&gt; 2 H2O</code> with <code>H2: 10.0 g</code>, <code>O2: 10.0 g</code> → O₂ limiting (ξ = 0.313 mol), 11.3 g H₂O, 8.74 g H₂ left over, drawn as moles available vs needed. Gas volumes use the STP you pick (IUPAC 22.711 or 1 atm 22.414 L/mol, both named); a liquid volume needs its density</li>
    </ul>
    <p class="examples-note">
      For fits, enter two equal-length lists (e.g. [S] and v), one value per number, separated
      by commas or spaces. Concentrations are linear (not log). Analysis aid — verify before publishing.
    </p>`,
  massspec: `
    <p class="examples-note">
      <strong>Mass-spectrometry</strong> readout for a compound — type a name, molecular
      formula, or SMILES and it computes offline.
    </p>
    <ul>
      <li><strong>Exact masses</strong> — monoisotopic (for high-res MS) and average</li>
      <li><strong>Isotope pattern</strong> — every stable isotope of every element, as nominal-mass peaks labelled from M (the most abundant isotope of each element): <code>C2Cl4</code> → base peak <strong>M+2</strong> 165.8725, M 78.1 %, M+4 48.0 %; an iron compound shows its ⁵⁴Fe peak as <strong>M−2</strong>. Drawn as a stick chart you can insert</li>
      <li><strong>Labelled isotopes</strong> — <code>[13CH3]C</code> → “Labelled isotopes: ¹³C × 1”; <code>CC[2H]</code> → C₂H₅D, ²H × 1</li>
      <li><strong>Adduct m/z</strong> — [M+H]⁺, [M+Na]⁺, [M+K]⁺, [M+NH₄]⁺, [M+2H]²⁺, [M−H]⁻, [M+Cl]⁻, [M+HCOO]⁻, [M−2H]²⁻</li>
      <li><strong>Formula or SMILES?</strong> <code>Co</code> is cobalt (58.9332), not CH₃O; <code>Fe2O3</code> has masses though no structure; when both readings are valid and differ the one used is said and the other named — <code>formula:</code> or <code>smiles:</code> chooses</li>
      <li><strong>Compare with acquired spectrum</strong> — open a measured JCAMP-DX mass spectrum and see it head-to-tail against the computed pattern, with a match table (proximity, not an assignment)</li>
    </ul>
    <p class="examples-note">
      Masses AME2020; compositions CIAAW 2024, covering all 84 elements with a natural isotopic
      composition (H–U). Natural composition only (no enrichment), no fine structure; an element
      with no stable isotope (Tc, Pm) is refused unless you name the isotope (<code>[99Tc]</code>).
      Analysis aid — verify before relying.
    </p>`,
  solidform: `
    <p class="examples-note">
      Your own instrument data — press <strong>Example</strong> for a synthetic pattern or thermogram.
    </p>
    <ul>
      <li><strong>XRPD</strong>: two columns (2θ and counts) → peaks, d-spacings, and “characterized by … peaks at 2θ angles of about … ± 0.2° 2θ”</li>
      <li><strong>Peak list</strong>: <code>6.8 100</code>, <code>13.6 40</code>, <code>17.2 80</code> — or <code>5.2, 10.4, 15.6</code></li>
      <li><strong>DSC</strong>: temperature and heat flow → endotherm onset (tangent method) and peak</li>
      <li><strong>TGA</strong>: temperature and weight (% or mg) → each weight-loss step</li>
    </ul>
    <p class="examples-note">Figures follow the pane's figure style (USPTO or a journal).</p>`,

  diagram: `
    <p class="examples-note">
      Patent figures from short text, in USPTO style — press <strong>Example</strong> for each kind.
    </p>
    <ul>
      <li><strong>Block diagram</strong>: <code>104 Physiological sensor</code>, <code>112 Control circuit</code>, <code>104 -&gt; 112</code></li>
      <li><strong>Flowchart</strong>: <code>start</code>, <code>405 Detect a parameter</code>, <code>? 410 Asleep?</code>, <code>410 yes -&gt; 415</code>, <code>410 no -&gt; 405</code>, <code>end</code></li>
      <li><strong>State diagram</strong>: <code>[*] -&gt; Idle</code>, <code>Idle -&gt; Active : start</code></li>
      <li><strong>Sequence diagram</strong>: <code>participant 102 Client</code>, <code>102 -&gt; 104 : request</code>, <code>104 --&gt; 102 : response</code></li>
      <li><strong>Timing diagram</strong>: <code>CLK: clock 8</code>, <code>DATA: x x A0 A0 D1 D1 x x</code></li>
      <li><strong>Schematic</strong>: <code>R1 resistor 0,0 2,0 10k</code>, <code>C1 capacitor 2,0 2,-2</code>, <code>GND ground 2,-2</code>, <code>wire 0,0 0,-2</code></li>
    </ul>
    <p class="examples-note">Numerals in the box (underlined) or outside with lead lines; a FIG label and the figure's own numeral (100). Lettering ≥ 1/8 in.</p>`,

  charz: `
    <p class="examples-note">
      <strong>Characterization text</strong> for an Example section — your measured data, written in
      journal form and checked against the compound. Nothing is predicted or filled in: only the Calcd
      values and the yield arithmetic are computed.
    </p>
    <ul>
      <li><strong>¹H NMR</strong> — paste MestReNova's paragraph (<code>1H NMR (400 MHz, Chloroform-d) δ 7.36 – 7.27 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).</code>) or type one signal per line (<code>7.26 d 8.0 2H</code>). JOC style gives <em>¹H NMR (CDCl₃, 400 MHz): δ 7.36–7.27 (m, 5H), …</em> with an italic <em>J</em></li>
      <li><strong>Checks</strong> — integrations against the formula's ¹H count (OH/NH named; expected absent in D₂O or CD₃OD), dd with one J, a segment that could not be read (named, never dropped), ¹³C count against symmetry-distinct carbons</li>
      <li><strong>¹³C NMR</strong> — <code>170.9, 136.0, 128.6, 128.3 (2C), …</code>; JOC style writes ¹³C{¹H} and rounds to 0.1 ppm without merging close peaks; C–F doublets as <code>162.4 (d, J = 246.0 Hz)</code></li>
      <li><strong>HRMS</strong> — <code>caffeine</code>, [M + H]⁺, Found <code>195.0874</code> → <em>HRMS (ESI/TOF) m/z: [M + H]⁺ Calcd for C₈H₁₁N₄O₂ 195.0877; Found 195.0874.</em> Outside 0.003 m/z it says so and names the ion the value does match ([M + Na]⁺?)</li>
      <li><strong>Yield, mp, R<sub>f</sub>, elemental analysis</strong> — 139 mg of benzyl acetate from 1.00 mmol → (139 mg, 0.926 mmol, 93%); C/H/N Found within 0.4 %</li>
      <li><strong>From Build</strong> — takes the structure you drew as the compound</li>
    </ul>
    <p class="examples-note">
      Format and tolerances from the J. Org. Chem. author guidelines; the Common style keeps
      MestReNova's order and your digits exactly as typed. Inserted as formatted Word text.
    </p>`,
  spectra: `
    <p class="examples-note">
      <strong>Predicted spectra</strong> from a structure — type a name, formula, or SMILES.
      These are <strong>estimates from published additivity rules</strong>, not acquired spectra
      and not quantum-chemical calculations: structure recognition is exact, the numbers are
      empirical, and every prediction states its own accuracy.
    </p>
    <ul>
      <li><strong>¹H NMR</strong> — shift, integration and <em>n+1</em> multiplicity per signal, with an assignment. Symmetry-aware, so benzene is one 6H singlet. Try <code>toluene</code> (CH₃ ≈ 2.4, 3H, s). Typical <strong>±0.2–0.4 ppm</strong></li>
      <li><strong>Diastereotopic groups</strong> — read from the structure's topology: <code>valine</code>'s two CH₃ are two rows at δ 0.87 with a note; <code>ibuprofen</code>'s ArCH₂ is <strong>m (²J 14–18 Hz)</strong> — the typical geminal range, not a predicted value. The Δδ between partners is not predicted</li>
      <li><strong>¹³C NMR</strong> — Grant–Paul additivity (sp³) + benzene increments (aromatic); carbonyl classes separate properly (ketone ≈ 205, aldehyde ≈ 199, acid ≈ 178, ester ≈ 171). Typical <strong>±2–4 ppm</strong></li>
      <li><strong>IR</strong> — characteristic group frequencies + a simulated transmittance trace. Ester ≈ 1740 &gt; ketone ≈ 1715 &gt; amide ≈ 1660; conjugation drops C=O ~25 cm⁻¹ (<code>acetophenone</code> ≈ 1690)</li>
      <li><strong>UV-Vis</strong> — λmax by <strong>Woodward–Fieser</strong> with every increment shown, so you can audit the arithmetic (<code>CC(=O)C=C(C)C</code> → 239 nm). A cross-conjugated dienone scores every enone arm and reports the longest; an extended enone (<code>CC=CC=CC(=O)C</code> → 263 nm) carries an extended-accuracy caveat; aryl enones (<code>cinnamaldehyde</code>, chalcone) and quinones are refused by name</li>
      <li><strong>MS fragmentation</strong> — exact fragment m/z via α-cleavage, benzylic→tropylium, McLafferty and gated neutral losses (<code>toluene</code> → m/z 91 tropylium, its real base peak)</li>
      <li><strong>Compare with acquired spectrum</strong> — open a measured JCAMP-DX file below the prediction and press <em>Compare</em>: the two are overlaid (sticks for NMR, a curve for IR, a λmax marker for UV, head-to-tail for MS) with a match table — each predicted line, the nearest measured peak and Δ. Give a reference peak (<code>7.36 = 7.26</code>) if the file's referencing is off. A match is proximity, not an assignment</li>
    </ul>
    <p class="examples-note">
      Out-of-domain cases are disclosed, never guessed: an unconjugated molecule reports
      <em>transparent</em> rather than a made-up λmax; fused and heteroaromatic rings say they are
      approximate; MS "likelihood" is a rule-based <strong>ranking, not an intensity</strong>. The IR
      fingerprint region (below ~1500 cm⁻¹) is not predicted. Insert a data table or a spectrum
      chart — δ increases leftward and wavenumber decreases rightward, per convention.
      Assignment aid — always verify against an acquired spectrum.
    </p>`,
  align: `
    <p class="examples-note">
      <strong>Align</strong> — compare two sequences and insert the alignment at the cursor.
      Needleman–Wunsch (global) and Smith–Waterman (local) with <strong>affine gaps</strong>,
      the same algorithms EMBOSS <code>needle</code> and <code>water</code> run. Everything
      happens on your machine; nothing is uploaded.
    </p>
    <ul>
      <li><strong>Global</strong> — forces an end-to-end alignment. Use it when the two
        sequences are the same thing: your clone against the reference, two alleles, a
        sequencing read against the expected insert</li>
      <li><strong>Local</strong> — finds the single best-scoring subsegment. Use it when
        they only share a domain or a motif, or differ a lot in length. A <em>global</em>
        alignment of two sequences that share only a domain is real output that means
        nothing</li>
      <li><strong>Protein</strong> uses BLOSUM62 (gap open 10, extend 0.5) —
        <code>MKTAYIAKQRQISFVKSHFSRQ</code></li>
      <li><strong>DNA/RNA</strong> uses +5 match / −4 mismatch. <code>U</code> is treated as
        <code>T</code>, so RNA compares against DNA; <code>N</code> scores 0 against
        anything</li>
      <li>Paste plain sequence or FASTA — headers, line numbers and whitespace are stripped</li>
    </ul>
    <p class="examples-note">
      Two things worth knowing. <strong>Percent identity is not a fact about the
      sequences</strong> — it is a fact about the alignment, and it moves when you change
      the gap costs. And below about <strong>25% identity</strong> (the "twilight zone")
      two unrelated proteins will still align convincingly; the tool says so when you get
      there. An optimal alignment is the highest-scoring one under the parameters you
      chose, not necessarily the biologically correct one.
    </p>`,
  cad: `
    <p class="examples-note">
      <strong>Drawing (CAD)</strong> — build a part from shapes, turn it like the 3D molecule
      view, and insert an engineering or patent drawing. Every view's hidden lines are worked
      out on your machine; nothing is uploaded.
    </p>
    <ul>
      <li><strong>Add parts</strong>: block, cylinder / pin, tube / bushing, cone, sphere, plate with a
      hole grid, L-bracket, stepped shaft, flange with a bolt circle. Dimensions are what a drafter
      writes — <em>diameters</em>, not radii — and an impossible part (holes through the edge, a bore
      bigger than the flange) is refused with the reason, never drawn wrong</li>
      <li><strong>Move</strong> and <strong>turn</strong> each part (X, Y, Z) to assemble them</li>
      <li><strong>Drag</strong> the 3D view to orbit, <strong>wheel</strong> to zoom, click a part to edit it;
      Front / Top / Right / Isometric snap to the standard views</li>
      <li><strong>Add callout</strong>, then click a surface: a <strong>balloon</strong> (engineering) or a
      <strong>reference numeral on a lead line</strong> (patent, continuing your Numerals table). A callout
      shows in every view where its point is visible, and only there</li>
    </ul>
    <p class="examples-note">
      <strong>Standards.</strong> <em>ASME</em> (third-angle: top view above the front, right side to its
      right; 0.6 / 0.3 mm lines; 3 mm text, 6 mm view titles) is the default; <em>ISO</em> (first-angle:
      top view below, the view from the right on the left; 0.5 / 0.25 mm; 2.5 mm text) is one click away;
      <em>USPTO</em> labels views FIG. 1, FIG. 2 in reading order with numerals at least 3.2 mm high inside
      the 1.84 sight; <em>Journal</em> and <em>Plain line art</em> for papers. Hidden lines follow the standard
      (dashed in engineering orthographic views, off elsewhere) unless you tick the box.
    </p>
    <p class="examples-note">
      This release builds parts from shapes; a 2D sketcher with dimensions and constraints, section
      views and CAD file import are on the way. Touching parts are separate bodies, so a seam shows where
      two are meant to be one piece. Drafting aid — check every drawing before filing or release.
    </p>`,
  seqmap: `
    <p class="examples-note">
      <strong>Sequence Map</strong> — open a sequence file and insert an annotated map at the
      cursor. Read entirely on your machine; nothing is uploaded.
    </p>
    <ul>
      <li><strong>GenBank</strong> (<code>.gb</code>, <code>.gbk</code>, <code>.gbff</code>) — the one that draws a <em>real</em> map, because it carries the <strong>feature annotations</strong>: promoters, CDS, resistance markers, primer sites, origins</li>
      <li><strong>FASTA</strong> (<code>.fa</code>, <code>.fasta</code>) — sequence only. FASTA has no annotations and no topology, so you get the backbone and scale but no features. That's the format, not a limitation of the tool</li>
      <li><strong>SnapGene .dna</strong> — opens directly, but see the note below</li>
      <li>Or <strong>paste</strong> a GenBank record, a FASTA block, or a bare sequence</li>
    </ul>
    <p class="examples-note">
      <strong>Exporting from SnapGene, Benchling or ApE?</strong> Export as <strong>GenBank</strong> —
      every one of them can, and the annotations come with it. <strong>GenBank is the
      supported path</strong> and is validated against real records.
    </p>
    <p class="examples-note">
      <strong>About .dna files.</strong> The SnapGene <code>.dna</code> format is proprietary and
      undocumented; this reader is written from a public reverse-engineering write-up and has
      <strong>not been verified against a real .dna file</strong>. It's a convenience: if it can't
      read yours it will say so and ask for GenBank, rather than show you a wrong sequence. If a
      .dna file fails here, exporting it as GenBank always works.
    </p>
    <ul>
      <li>Arrows show <strong>strand</strong>: a <code>complement(...)</code> feature points left</li>
      <li>A <strong>joined CDS</strong> (<code>join(21..30,41..50)</code>) draws one body per exon with a dashed connector — the intron is not drawn as coding sequence</li>
      <li><strong>Map style</strong> — <em>Auto</em> follows the record: a plasmid draws as the classic <strong>circular map</strong> (position 1 at 12 o'clock, clockwise), a linear sequence as a linear one. Force either if you need to</li>
      <li>Tick <strong>black &amp; white line art</strong> for a patent figure</li>
      <li>On a circular plasmid, a feature crossing the origin can't be drawn honestly on a linear map — the map says so rather than dropping it silently</li>
    </ul>
    <p class="examples-note">
      The inserted figure carries the construct's name, length, topology and feature count in its
      alt-text. Drafting aid — check the map against your own record before publishing or filing.
    </p>`,
  peptide: `
    <p class="examples-note">
      Draw a <strong>peptide's 2D structure</strong> from its sequence — then insert it.
    </p>
    <ul>
      <li><strong>One-letter</strong> codes: <code>ACDEFG</code> (spaces optional)</li>
      <li><strong>Three-letter</strong> codes with separators: <code>Ala-Gly-Ser</code> or <code>Met Lys</code></li>
      <li>Termini <code>H-</code>/<code>-OH</code>, <code>Ac-</code>, <code>-NH2</code>, <code>pGlu-</code>; head-to-tail <code>cyclo(GRGDSP)</code> → C₂₂H₃₅N₉O₉, monoisotopic 569.2558 Da</li>
      <li>Modifications in ProForma brackets: <code>AKS[Phospho]PR</code> → +79.966331 (UNIMOD:21), 637.2949 Da; <code>M[Oxidation]</code>, <code>K[Acetyl]</code></li>
      <li>Disulfides as a clause: <code>CYIQNCPLG-NH2; disulfide 1-6</code> (oxytocin) → C₄₃H₆₆N₁₂O₁₂S₂, 1006.4365 Da, with ε₂₈₀ for the cystines as written</li>
      <li>Reports formula, <strong>monoisotopic and average</strong> mass and every modification with its Unimod accession and delta; anything it cannot read is refused by name (<code>cycloGRGDSP</code> would be Cys-Tyr-Cys-Leu-Pyl)</li>
    </ul>
    <p class="examples-note">
      The structure shows <strong>connectivity</strong> (stereochemistry isn't drawn, to avoid asserting
      a wrong configuration). Long peptides (above 250 heavy atoms, about 30 residues) get their masses but no drawing —
      the 2D layout would freeze Word. Verify before relying.
    </p>`,
  stats: `
    <p class="examples-note">
      <strong>Statistics &amp; uncertainty</strong> — pick a test, paste your data, and it computes
      a paper-ready result offline.
    </p>
    <ul>
      <li><strong>Descriptive</strong> — n, mean, SD, SEM, median, 95% CI, CV from one list</li>
      <li><strong>t-tests</strong> — two-sample (Welch/Student) &amp; paired, with a <strong>p-value</strong> and an APA report (<em>t</em>(18) = 2.41, <em>p</em> = .027)</li>
      <li><strong>One-way ANOVA</strong> and <strong>linear regression</strong> (slope, R², slope p)</li>
      <li><strong>Non-parametric</strong> — Mann–Whitney U (independent) and Wilcoxon signed-rank (paired), with an <strong>exact p</strong> up to n = 60 (conditional on ties) and the normal approximation shown beside it</li>
      <li><strong>Repeated-measures ANOVA</strong> — one row per subject (optionally a group label first for a mixed design): Mauchly's test, Greenhouse–Geisser and Huynh–Feldt ε with corrected df (GG: <em>F</em>(1.60, 11.19) = 3.794, <em>p</em> = 0.0626 on the default), Holm-adjusted paired comparisons, and a profile plot with within-subject CIs</li>
      <li><strong>Cox regression</strong> — a header line (<code>time status age …</code>) then one row per subject: β, HR with 95% CI (placebo HR = 4.817, 2.147 to 10.81 on the default), likelihood-ratio/Wald/score tests, concordance and a proportional-hazards check, with a log-axis hazard-ratio forest plot and adjusted survival curves</li>
      <li><strong>Chi-square</strong> — goodness of fit and test of independence (contingency table)</li>
      <li><strong>Two-way ANOVA</strong> (enter <code>factorA factorB value</code> per line) and <strong>multiple-comparison correction</strong> (Bonferroni / Holm / Benjamini–Hochberg)</li>
      <li><strong>Uncertainty propagation</strong> — a formula plus <code>a = 10 ± 0.1</code> lines → result ± combined 1σ</li>
      <li><strong>Power &amp; sample size</strong> — n per group for a target power, or the power at a given n: two-sample / paired t (Cohen's <em>d</em>), one-way ANOVA (Cohen's <em>f</em>), two proportions; drawn as a power curve</li>
    </ul>
    <p class="examples-note">
      <strong>Use table at cursor</strong> works on every calculator: click inside a Word table and the field fills itself.
      Groups go one per column (a header row names them) or as label + value rows; repeated measures one row per subject
      or long format (Subject | Time | Score); survival as time and event (1/0) columns, plus a group column for Log-rank;
      Cox regression as time, event and covariate columns (text columns become indicators, the reference named);
      two-way ANOVA as factor A, factor B, value rows or a crosstab. The status line says how the table was read.
    </p>
    <p class="examples-note">
      Enter numbers separated by spaces, commas, or new lines. A comma inside a space-separated value is a decimal comma
      (<code>1,5 2,3</code> is 1.5 and 2.3, and the result says so); type <code>1, 5</code> for a list. Analysis aid — verify before publishing.
    </p>`,
  analyze: `
    <p class="examples-note">
      <strong>Analyze</strong> — a no-code numerical workbench. Pick a tool; every field is pre-filled
      with a worked example you can edit, and the result computes live on your machine.
    </p>
    <ul>
      <li><strong>Solve A·x = b</strong> — a square system; enter A one row per line (<code>2 1</code> / <code>1 -1</code>) and b (<code>5, 1</code>) → x</li>
      <li><strong>Inverse</strong> and <strong>Determinant, rank &amp; trace</strong> — singular matrices are reported, never faked</li>
      <li><strong>Eigenvalues</strong> — symmetric (real values + eigenvectors) or <em>any</em> square matrix (complex pairs as a ± bi)</li>
      <li><strong>QR</strong> and <strong>SVD</strong> decompositions; <strong>Multiply</strong> A·B and <strong>Transpose</strong></li>
      <li><strong>Matrix expression</strong> — name matrices, then evaluate <code>A*inv(B) + 2*C'</code> in one line</li>
      <li><strong>Data → insights</strong> — paste a table (a header row and tab/comma/space columns are auto-detected) and get column summaries, <strong>correlations</strong> (Pearson r + p, Spearman ρ), <strong>trends</strong>, outlier/missing flags, and plain-language findings</li>
      <li><strong>Minimize a function</strong> — Nelder–Mead optimization of an objective you type, e.g. <code>(1-x)^2 + 100*(y-x^2)^2</code></li>
      <li><strong>FFT / spectrum</strong> — a sampled signal → amplitude spectrum, dominant frequencies, and a chart</li>
      <li><strong>ODE / system</strong> — type the equation you have: <code>y' = -y</code>, a coupled system, or <strong>higher order directly</strong> (<code>y'' = -0.1*y' - y</code> with <code>y = 1, y' = 0</code>) — the reduction to first order is done for you → sampled table + trajectory plot. <strong>Stiff systems</strong> (kinetics with widely separated rate constants) are detected automatically and switched to an implicit solver</li>
      <li><strong>Differential-algebraic system</strong> — differential equations plus constraints, <strong>any index up to 5</strong>. The Cartesian pendulum as typed: equations <code>x' = u</code>, <code>y' = v</code>, <code>u' = -lam*x</code>, <code>v' = -lam*y - 9.81</code>, constraint <code>x^2 + y^2 - 1</code>, initial values <code>x = 1, y = 0, u = 0, v = 0</code>, t from 0 to 10 → <strong>structural index 3</strong> (Pantelides), the hidden constraints u·x + v·y = 0 and −lam·x² − lam·y² + u² + v² − 9.81·y = 0, and the drift of each constraint before and after projection. Initial values are bound <strong>by name</strong> (their order cannot matter), λ is read as <code>lam</code>, and an inconsistent start is projected and reported (<code>u = 1</code> → moved to u₀ = 0)</li>
    </ul>
    <p class="examples-note">
      Matrix rows go one per line, entries separated by spaces or commas. Everything is computed
      offline from your own numbers. Analysis aid — verify before publishing.
    </p>`,
};
