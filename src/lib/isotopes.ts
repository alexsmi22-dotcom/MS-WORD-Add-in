// Natural isotopic compositions and exact isotope masses for every element that
// HAS a representative composition — the reference for monoisotopic masses,
// isotope patterns and adduct m/z in Mass Spec (v2.138.0).
//
// WHY THIS FILE EXISTS. Mass Spec took its monoisotopic masses from OpenChemLib,
// and OpenChemLib is wrong for some elements: Cu is 10 mDa high (62.93960 against
// ⁶³Cu 62.92960, 54 ppm on Cu(NO₃)₂), Pa is ²¹⁶Pa (15 Da low) instead of ²³¹Pa,
// and Tc, Po and Ra, which have NO stable isotope, were given invented masses. The
// isotope table it convolved held 15 elements, so FeCl₃, HgCl₂, cisplatin and every
// other compound outside them was drawn as though the metal were not there.
//
// SOURCES — three, each stored VERBATIM below and hashed (the test recomputes the
// hashes, so a transcription slip fails the build; the numbers are derived from
// the strings at load, never hand-typed):
//
//   1. COMPOSITIONS: CIAAW, "Isotopic Compositions of the Elements 2024",
//      ciaaw.org/isotopic-abundances.htm, retrieved 2026-10-14 (page sha256
//      1ab770a48bb539d26ad2992a94b4c60d51743058b67f106796b754cd5035423b). The
//      table's own base reference is J. Meija et al., "Isotopic compositions of the
//      elements 2013", Pure Appl. Chem. 88, 293–306 (2016), with the CIAAW
//      revisions since then (Yb 2015, Ta 2017, Ir 2017, Ar 2017, Hf 2019, Pb 2021,
//      Gd 2024, Lu 2024, Zr 2024) included. NOTE THE EDITION: the brief asked for
//      the 2021 values; the live table is headed 2024, and that is what ships. No
//      other edition is mixed in.
//   2. INTERVAL ELEMENTS (H Li B C N O Mg Si S Cl Ar Br Tl Pb): CIAAW gives an
//      interval, not a number. The single value used is NIST's representative
//      composition — "Atomic Weights and Isotopic Compositions", physics.nist.gov
//      (Coursey, Schwab, Tsai & Dragoset), retrieved 2026-10-14 (sha256
//      0fc258b1242ee6c2e96dc1cfd7e99ed197cca244f15f5fffca59cc9478fdc2c1). The test
//      asserts every value USED lies INSIDE its CIAAW interval: where NIST's
//      value does not (³⁶S only: 0.0001 against [0.000129, 0.000187]) the
//      interval midpoint is used instead and flagged. Real samples vary across
//      the interval; the pattern is for one representative composition.
//   3. MASSES: AME2020 — M. Wang, W.J. Huang, F.G. Kondev, G. Audi, S. Naimi,
//      Chin. Phys. C 45, 030003 (2021); file mass_1.mas20 (sha256
//      e8599c6d7f724fac91934e59f1b9de8fb8f63e820f4b39456b790665ed2a3307), the
//      atomic-mass column in micro-u, copied as printed ("1 007825.031898").
//      Cross-checked against NIST's "Relative Atomic Mass" column: the two
//      agree to ≤ 3.1e-5 u on every stable isotope here (largest: ¹⁰²Pd;
//      121 of 289 differ by more than 1e-6 u).
//      AME2020 is what ships; NIST masses are not used.
//
// ROW FORMAT  Z|symbol|A|AME2020 mass (µu, verbatim)|CIAAW composition (verbatim)|NIST value (interval elements only)
//
// Pure; no Office.js, no OpenChemLib.

import { atomicNumber, elementName } from "./periodic";

export const ISOTOPE_SOURCES = {
  composition:
    "CIAAW, Isotopic Compositions of the Elements 2024 (ciaaw.org; base report Meija et al., Pure Appl. Chem. 88, 293–306, 2016), retrieved 2026-10-14",
  compositionEdition: "2024",
  compositionSha256: "1ab770a48bb539d26ad2992a94b4c60d51743058b67f106796b754cd5035423b",
  intervalValues: "NIST Atomic Weights and Isotopic Compositions (representative composition), retrieved 2026-10-14",
  intervalValuesSha256: "0fc258b1242ee6c2e96dc1cfd7e99ed197cca244f15f5fffca59cc9478fdc2c1",
  masses: "AME2020 (Wang et al., Chin. Phys. C 45, 030003, 2021), mass_1.mas20",
  massesSha256: "e8599c6d7f724fac91934e59f1b9de8fb8f63e820f4b39456b790665ed2a3307",
  electron: "CODATA 2018 electron mass, 5.48579909065e-4 u",
} as const;

/** sha256 of ISOTOPE_ROWS (UTF-8), computed when the rows were extracted. */
export const ISOTOPE_ROWS_SHA256 = "cd89e5b4033d7ba431cb16bfed771948a7ce5e8d506024394e4d9a8b92de93a1";
/** sha256 of LABEL_ROWS. */
export const LABEL_ROWS_SHA256 = "1a48379a1b3a88e915757e1a0eb4acef98747920be450634b2e4c95e6d85f7ac";
/** sha256 of NO_STABLE_ROWS. */
export const NO_STABLE_ROWS_SHA256 = "9825bdceeafeba0c6802b8172758850abe039914658c451e69208908c0b1b226";

/** CODATA 2018 electron mass, u. */
export const ELECTRON_MASS = 0.000548579909065;

/** The 84 elements with a CIAAW representative composition: 289 isotopes. */
export const ISOTOPE_ROWS = `1|H|1|1 007825.031898|[0.99972, 0.99999]|0.999885(70)
1|H|2|2 014101.777844|[0.00001, 0.00028]|0.000115(70)
2|He|3|3 016029.32197|0.000002(2)|
2|He|4|4 002603.25413|0.999998(2)|
3|Li|6|6 015122.88742|[0.019, 0.078]|0.0759(4)
3|Li|7|7 016003.43426|[0.922, 0.981]|0.9241(4)
4|Be|9|9 012183.062|1|
5|B|10|10 012936.862|[0.189, 0.204]|0.199(7)
5|B|11|11 009305.166|[0.796, 0.811]|0.801(7)
6|C|12|12 000000.0|[0.9884, 0.9904]|0.9893(8)
6|C|13|13 003354.83534|[0.0096, 0.0116]|0.0107(8)
7|N|14|14 003074.00425|[0.99578, 0.99663]|0.99636(20)
7|N|15|15 000108.89827|[0.00337, 0.00422]|0.00364(20)
8|O|16|15 994914.61926|[0.99738, 0.99776]|0.99757(16)
8|O|17|16 999131.75595|[0.000367, 0.000400]|0.00038(1)
8|O|18|17 999159.61214|[0.00187, 0.00222]|0.00205(14)
9|F|19|18 998403.16207|1|
10|Ne|20|19 992440.17525|0.9048(3)|
10|Ne|21|20 993846.685|0.0027(1)|
10|Ne|22|21 991385.113|0.0925(3)|
11|Na|23|22 989769.28195|1|
12|Mg|24|23 985041.689|[0.7888, 0.7905]|0.7899(4)
12|Mg|25|24 985836.966|[0.09988, 0.10034]|0.1000(1)
12|Mg|26|25 982592.972|[0.1096, 0.1109]|0.1101(3)
13|Al|27|26 981538.408|1|
14|Si|28|27 976926.53442|[0.92191, 0.92318]|0.92223(19)
14|Si|29|28 976494.66434|[0.04645, 0.04699]|0.04685(8)
14|Si|30|29 973770.137|[0.03037, 0.03110]|0.03092(11)
15|P|31|30 973761.99768|1|
16|S|32|31 972071.17354|[0.9441, 0.9529]|0.9499(26)
16|S|33|32 971458.90862|[0.00729, 0.00797]|0.0075(2)
16|S|34|33 967867.011|[0.0396, 0.0477]|0.0425(24)
16|S|36|35 967080.692|[0.000129, 0.000187]|0.0001(1)
17|Cl|35|34 968852.694|[0.755, 0.761]|0.7576(10)
17|Cl|37|36 965902.573|[0.239, 0.245]|0.2424(10)
18|Ar|36|35 967545.106|[0.0000, 0.0207]|0.003336(21)
18|Ar|38|37 962732.102|[0.000, 0.043]|0.000629(7)
18|Ar|40|39 962383.12204|[0.936, 1.000]|0.996035(25)
19|K|39|38 963706.48482|0.932581(44)|
19|K|40|39 963998.165|0.000117(1)|
19|K|41|40 961825.25611|0.067302(44)|
20|Ca|40|39 962590.850|0.96941(156)|
20|Ca|42|41 958617.780|0.00647(23)|
20|Ca|43|42 958766.381|0.00135(10)|
20|Ca|44|43 955481.489|0.02086(110)|
20|Ca|46|45 953687.726|0.00004(3)|
20|Ca|48|47 952522.654|0.00187(21)|
21|Sc|45|44 955907.051|1|
22|Ti|46|45 952626.356|0.0825(3)|
22|Ti|47|46 951757.491|0.0744(2)|
22|Ti|48|47 947940.677|0.7372(3)|
22|Ti|49|48 947864.391|0.0541(2)|
22|Ti|50|49 944785.622|0.0518(2)|
23|V|50|49 947156.681|0.00250(10)|
23|V|51|50 943957.664|0.99750(10)|
24|Cr|50|49 946042.209|0.04345(13)|
24|Cr|52|51 940504.714|0.83789(18)|
24|Cr|53|52 940646.304|0.09501(17)|
24|Cr|54|53 938877.359|0.02365(7)|
25|Mn|55|54 938043.040|1|
26|Fe|54|53 939608.189|0.05845(105)|
26|Fe|56|55 934935.537|0.91754(106)|
26|Fe|57|56 935391.950|0.02119(29)|
26|Fe|58|57 933273.575|0.00282(12)|
27|Co|59|58 933193.524|1|
28|Ni|58|57 935341.650|0.680769(190)|
28|Ni|60|59 930785.129|0.262231(150)|
28|Ni|61|60 931054.819|0.011399(13)|
28|Ni|62|61 928344.753|0.036345(40)|
28|Ni|64|63 927966.228|0.009256(19)|
29|Cu|63|62 929597.119|0.6915(15)|
29|Cu|65|64 927789.476|0.3085(15)|
30|Zn|64|63 929141.776|0.4917(75)|
30|Zn|66|65 926033.639|0.2773(98)|
30|Zn|67|66 927127.422|0.0404(16)|
30|Zn|68|67 924844.232|0.1845(63)|
30|Zn|70|69 925319.175|0.0061(10)|
31|Ga|69|68 925573.528|0.60108(50)|
31|Ga|71|70 924702.554|0.39892(50)|
32|Ge|70|69 924248.542|0.2052(19)|
32|Ge|72|71 922075.824|0.2745(15)|
32|Ge|73|72 923458.954|0.0776(8)|
32|Ge|74|73 921177.760|0.3652(12)|
32|Ge|76|75 921402.725|0.0775(12)|
33|As|75|74 921594.562|1|
34|Se|74|73 922475.933|0.0086(3)|
34|Se|76|75 919213.702|0.0923(7)|
34|Se|77|76 919914.150|0.0760(7)|
34|Se|78|77 917309.244|0.2369(22)|
34|Se|80|79 916521.761|0.4980(36)|
34|Se|82|81 916699.531|0.0882(15)|
35|Br|79|78 918337.574|[0.505, 0.508]|0.5069(7)
35|Br|81|80 916288.197|[0.492, 0.495]|0.4931(7)
36|Kr|78|77 920366.341|0.00355(3)|
36|Kr|80|79 916377.940|0.02286(10)|
36|Kr|82|81 913481.15368|0.11593(31)|
36|Kr|83|82 914126.516|0.11500(19)|
36|Kr|84|83 911497.72708|0.56987(15)|
36|Kr|86|85 910610.62468|0.17279(41)|
37|Rb|85|84 911789.73604|0.7217(2)|
37|Rb|87|86 909180.529|0.2783(2)|
38|Sr|84|83 913419.118|0.0056(2)|
38|Sr|86|85 909260.72473|0.0986(20)|
38|Sr|87|86 908877.49454|0.0700(20)|
38|Sr|88|87 905612.253|0.8258(35)|
39|Y|89|88 905838.156|1|
40|Zr|90|89 904698.755|0.5147(6)|
40|Zr|91|90 905640.205|0.1123(6)|
40|Zr|92|91 905035.336|0.1716(4)|
40|Zr|94|93 906312.523|0.1736(7)|
40|Zr|96|95 908277.615|0.0278(4)|
41|Nb|93|92 906373.170|1|
42|Mo|92|91 906807.153|0.14649(106)|
42|Mo|94|93 905083.586|0.09187(33)|
42|Mo|95|94 905837.436|0.15873(30)|
42|Mo|96|95 904674.770|0.16673(8)|
42|Mo|97|96 906016.903|0.09582(15)|
42|Mo|98|97 905403.609|0.24292(80)|
42|Mo|100|99 907467.982|0.09744(65)|
44|Ru|96|95 907588.910|0.0554(14)|
44|Ru|98|97 905286.709|0.0187(3)|
44|Ru|99|98 905930.284|0.1276(14)|
44|Ru|100|99 904210.460|0.1260(7)|
44|Ru|101|100 905573.086|0.1706(2)|
44|Ru|102|101 904340.312|0.3155(14)|
44|Ru|104|103 905425.312|0.1862(27)|
45|Rh|103|102 905494.081|1|
46|Pd|102|101 905632.292|0.0102(1)|
46|Pd|104|103 904030.393|0.1114(8)|
46|Pd|105|104 905079.479|0.2233(8)|
46|Pd|106|105 903480.287|0.2733(3)|
46|Pd|108|107 903891.806|0.2646(9)|
46|Pd|110|109 905172.878|0.1172(9)|
47|Ag|107|106 905091.509|0.51839(8)|
47|Ag|109|108 904755.778|0.48161(8)|
48|Cd|106|105 906459.791|0.01245(22)|
48|Cd|108|107 904183.588|0.00888(11)|
48|Cd|110|109 903007.470|0.12470(61)|
48|Cd|111|110 904183.776|0.12795(12)|
48|Cd|112|111 902763.896|0.24109(7)|
48|Cd|113|112 904408.105|0.12227(7)|
48|Cd|114|113 903364.998|0.28754(81)|
48|Cd|116|115 904763.230|0.07512(54)|
49|In|113|112 904060.451|0.04281(52)|
49|In|115|114 903878.772|0.95719(52)|
50|Sn|112|111 904824.894|0.0097(1)|
50|Sn|114|113 902780.130|0.0066(1)|
50|Sn|115|114 903344.695|0.0034(1)|
50|Sn|116|115 901742.825|0.1454(9)|
50|Sn|117|116 902954.036|0.0768(7)|
50|Sn|118|117 901606.630|0.2422(9)|
50|Sn|119|118 903311.266|0.0859(4)|
50|Sn|120|119 902202.557|0.3258(9)|
50|Sn|122|121 903445.494|0.0463(3)|
50|Sn|124|123 905279.619|0.0579(5)|
51|Sb|121|120 903811.353|0.5721(5)|
51|Sb|123|122 904215.292|0.4279(5)|
52|Te|120|119 904065.779|0.0009(1)|
52|Te|122|121 903044.708|0.0255(12)|
52|Te|123|122 904271.022|0.0089(3)|
52|Te|124|123 902818.341|0.0474(14)|
52|Te|125|124 904431.178|0.0707(15)|
52|Te|126|125 903312.144|0.1884(25)|
52|Te|128|127 904461.237|0.3174(8)|
52|Te|130|129 906222.745|0.3408(62)|
53|I|127|126 904472.592|1|
54|Xe|124|123 905885.174|0.00095(5)|
54|Xe|126|125 904297.422|0.00089(3)|
54|Xe|128|127 903530.75341|0.01910(13)|
54|Xe|129|128 904780.85742|0.26401(138)|
54|Xe|130|129 903509.346|0.04071(22)|
54|Xe|131|130 905084.12808|0.21232(51)|
54|Xe|132|131 904155.08346|0.26909(55)|
54|Xe|134|133 905393.030|0.10436(35)|
54|Xe|136|135 907214.474|0.08857(72)|
55|Cs|133|132 905451.958|1|
56|Ba|130|129 906326.002|0.0011(1)|
56|Ba|132|131 905061.231|0.0010(1)|
56|Ba|134|133 904508.249|0.0242(15)|
56|Ba|135|134 905688.447|0.0659(10)|
56|Ba|136|135 904575.800|0.0785(24)|
56|Ba|137|136 905827.207|0.1123(23)|
56|Ba|138|137 905247.059|0.7170(29)|
57|La|138|137 907124.041|0.0008881(71)|
57|La|139|138 906362.927|0.9991119(71)|
58|Ce|136|135 907129.256|0.00185(2)|
58|Ce|138|137 905994.180|0.00251(2)|
58|Ce|140|139 905448.433|0.88450(51)|
58|Ce|142|141 909250.208|0.11114(51)|
59|Pr|141|140 907659.604|1|
60|Nd|142|141 907728.824|0.27152(40)|
60|Nd|143|142 909819.815|0.12174(26)|
60|Nd|144|143 910092.798|0.23798(19)|
60|Nd|145|144 912579.151|0.08293(12)|
60|Nd|146|145 913122.459|0.17189(32)|
60|Nd|148|147 916899.027|0.05756(21)|
60|Nd|150|149 920901.322|0.05638(28)|
62|Sm|144|143 912006.285|0.0308(4)|
62|Sm|147|146 914904.401|0.1500(14)|
62|Sm|148|147 914829.233|0.1125(9)|
62|Sm|149|148 917191.211|0.1382(10)|
62|Sm|150|149 917281.993|0.0737(9)|
62|Sm|152|151 919738.646|0.2674(9)|
62|Sm|154|153 922215.756|0.2274(14)|
63|Eu|151|150 919856.606|0.4781(6)|
63|Eu|153|152 921236.789|0.5219(6)|
64|Gd|152|151 919798.414|0.00204(2)|
64|Gd|154|153 920872.974|0.02187(9)|
64|Gd|155|154 922629.356|0.14828(60)|
64|Gd|156|155 922130.120|0.20493(22)|
64|Gd|157|156 923967.424|0.15657(17)|
64|Gd|158|157 924111.200|0.24820(20)|
64|Gd|160|159 927061.202|0.21811(28)|
65|Tb|159|158 925353.707|1|
66|Dy|156|155 924283.593|0.00056(3)|
66|Dy|158|157 924414.817|0.00095(3)|
66|Dy|160|159 925203.578|0.02329(18)|
66|Dy|161|160 926939.425|0.18889(42)|
66|Dy|162|161 926804.507|0.25475(36)|
66|Dy|163|162 928737.221|0.24896(42)|
66|Dy|164|163 929180.819|0.28260(54)|
67|Ho|165|164 930329.116|1|
68|Er|162|161 928787.299|0.00139(5)|
68|Er|164|163 929207.739|0.01601(3)|
68|Er|166|165 930301.067|0.33503(36)|
68|Er|167|166 932056.192|0.22869(9)|
68|Er|168|167 932378.282|0.26978(18)|
68|Er|170|169 935471.933|0.14910(36)|
69|Tm|169|168 934218.956|1|
70|Yb|168|167 933891.297|0.00126(1)|
70|Yb|170|169 934767.242|0.03023(2)|
70|Yb|171|170 936331.515|0.14216(7)|
70|Yb|172|171 936386.654|0.21754(10)|
70|Yb|173|172 938216.211|0.16098(9)|
70|Yb|174|173 938867.545|0.31896(26)|
70|Yb|176|175 942574.706|0.12887(30)|
71|Lu|175|174 940777.211|0.97414(5)|
71|Lu|176|175 942691.711|0.02586(5)|
72|Hf|174|173 940048.377|0.00161(2)|
72|Hf|176|175 941409.797|0.0524(14)|
72|Hf|177|176 943230.187|0.1858(9)|
72|Hf|178|177 943708.322|0.2728(6)|
72|Hf|179|178 945825.705|0.1363(3)|
72|Hf|180|179 946559.537|0.3512(16)|
73|Ta|180|179 947467.589|0.0001176(23)|
73|Ta|181|180 947998.528|0.9998824(23)|
74|W|180|179 946713.304|0.0012(1)|
74|W|182|181 948205.636|0.2650(16)|
74|W|183|182 950224.416|0.1431(4)|
74|W|184|183 950933.180|0.3064(2)|
74|W|186|185 954365.140|0.2843(19)|
75|Re|185|184 952958.320|0.3740(5)|
75|Re|187|186 955752.217|0.6260(5)|
76|Os|184|183 952492.919|0.0002(2)|
76|Os|186|185 953837.569|0.0159(64)|
76|Os|187|186 955749.569|0.0196(17)|
76|Os|188|187 955837.292|0.1324(27)|
76|Os|189|188 958145.949|0.1615(23)|
76|Os|190|189 958445.442|0.2626(20)|
76|Os|192|191 961478.765|0.4078(32)|
77|Ir|191|190 960591.455|0.3723(9)|
77|Ir|193|192 962923.753|0.6277(9)|
78|Pt|190|189 959949.823|0.00012(2)|
78|Pt|192|191 961042.667|0.00782(24)|
78|Pt|194|193 962683.498|0.32864(410)|
78|Pt|195|194 964794.325|0.33775(240)|
78|Pt|196|195 964954.648|0.25211(340)|
78|Pt|198|197 967896.718|0.07356(130)|
79|Au|197|196 966570.103|1|
80|Hg|196|195 965833.445|0.0015(1)|
80|Hg|198|197 966769.177|0.1004(3)|
80|Hg|199|198 968280.994|0.1694(12)|
80|Hg|200|199 968326.941|0.2314(9)|
80|Hg|201|200 970303.054|0.1317(9)|
80|Hg|202|201 970643.604|0.2974(13)|
80|Hg|204|203 973494.037|0.0682(4)|
81|Tl|203|202 972344.098|[0.2944, 0.2959]|0.2952(1)
81|Tl|205|204 974427.318|[0.7041, 0.7056]|0.7048(1)
82|Pb|204|203 973043.506|[0.0000, 0.0158]|0.014(1)
82|Pb|206|205 974465.210|[0.0190, 0.8673]|0.241(1)
82|Pb|207|206 975896.821|[0.0035, 0.2351]|0.221(1)
82|Pb|208|207 976652.005|[0.0338, 0.9775]|0.524(1)
83|Bi|209|208 980398.599|1|
90|Th|230|230 033132.267|0.0002(2)|
90|Th|232|232 038053.606|0.9998(2)|
91|Pa|231|231 035882.500|1|
92|U|234|234 040950.296|0.000054(5)|
92|U|235|235 043928.117|0.007204(6)|
92|U|238|238 050786.936|0.992742(10)|`;

/**
 * Elements (Z ≤ 92) with NO representative composition in the CIAAW table: no
 * stable isotope, so no monoisotopic mass and no natural pattern. The bracketed
 * mass number is CIAAW's own (its longest-lived isotope).
 */
export const NO_STABLE_ROWS = `43|Tc|[97]
61|Pm|[145]
84|Po|[209]
85|At|[210]
86|Rn|[222]
87|Fr|[223]
88|Ra|[226]
89|Ac|[227]`;

/**
 * Isotopes a user may NAME explicitly in SMILES ([99Tc], [14C], [18F], [131I]):
 * radiolabels and the longest-lived isotopes of the no-stable-isotope elements.
 * Masses only (AME2020, verbatim); never part of a natural pattern. An isotope
 * named outside this list and outside ISOTOPE_ROWS is refused by name.
 */
export const LABEL_ROWS = `1|H|3|3 016049.28132
6|C|11|11 011432.597
6|C|14|14 003241.98862
7|N|13|13 005738.609
8|O|15|15 003065.636
9|F|18|18 000937.324
11|Na|22|21 994437.547
11|Na|24|23 990963.012
15|P|32|31 973907.643
15|P|33|32 971725.692
16|S|35|34 969032.321
17|Cl|36|35 968306.822
19|K|42|41 962402.305
20|Ca|45|44 956186.270
24|Cr|51|50 944765.388
25|Mn|54|53 940355.772
26|Fe|55|54 938291.158
26|Fe|59|58 934873.492
27|Co|57|56 936289.819
27|Co|58|57 935751.292
27|Co|60|59 933815.536
29|Cu|64|63 929764.001
29|Cu|67|66 927729.490
31|Ga|67|66 928202.276
31|Ga|68|67 927980.161
32|Ge|68|67 928095.305
34|Se|75|74 922522.870
35|Br|76|75 924541.574
35|Br|82|81 916801.752
37|Rb|82|81 918209.023
37|Rb|86|85 911167.443
38|Sr|85|84 912932.041
38|Sr|89|88 907450.808
38|Sr|90|89 907727.870
39|Y|90|89 907141.749
40|Zr|89|88 908879.751
43|Tc|97|96 906360.720
43|Tc|98|97 907211.206
43|Tc|99|98 906249.681
44|Ru|103|102 906314.846
49|In|111|110 905107.236
53|I|123|122 905589.753
53|I|124|123 906210.297
53|I|125|124 904630.610
53|I|129|128 904983.643
53|I|131|130 906126.375
54|Xe|133|132 905910.748
55|Cs|134|133 906718.501
55|Cs|137|136 907089.296
61|Pm|145|144 912755.748
61|Pm|147|146 915144.944
62|Sm|153|152 922103.576
67|Ho|166|165 932291.209
71|Lu|177|176 943763.570
75|Re|186|185 954989.172
75|Re|188|187 958113.658
77|Ir|192|191 962602.414
79|Au|198|197 968243.714
81|Tl|201|200 970820.235
80|Hg|203|202 972872.396
82|Pb|210|209 984188.381
82|Pb|212|211 991895.891
83|Bi|213|212 994383.570
84|Po|208|207 981246.035
84|Po|209|208 982430.361
84|Po|210|209 982873.686
85|At|210|209 987147.423
85|At|211|210 987496.226
86|Rn|222|222 017576.017
87|Fr|223|223 019734.241
88|Ra|223|223 018500.648
88|Ra|224|224 020210.361
88|Ra|226|226 025408.186
88|Ra|228|228 031068.574
89|Ac|225|225 023228.601
89|Ac|227|227 027750.594
90|Th|228|228 028739.741
90|Th|229|229 031761.357
92|U|233|233 039634.294
92|U|236|236 045566.130`;

// ---------------------------------------------------------------------------
// Derived numbers (from the strings above, at load)
// ---------------------------------------------------------------------------

export interface IsotopeEntry {
  /** Mass number. */
  A: number;
  /** AME2020 atomic mass, u. */
  mass: number;
  /** Fraction used for patterns (normalised so the element sums to 1). */
  abundance: number;
  /** The CIAAW composition string, verbatim. */
  ciaaw: string;
  /** For an interval element: the NIST value used, verbatim. */
  nist?: string;
  /** For an interval element: the CIAAW interval. */
  interval?: [number, number];
  /** True when the NIST value lay outside the CIAAW interval and its midpoint was used. */
  intervalFallback?: boolean;
}

export interface ElementIsotopes {
  symbol: string;
  Z: number;
  isotopes: IsotopeEntry[];
  /** True when CIAAW gives intervals and the NIST value was used. */
  interval: boolean;
  /** The most abundant isotope: the one M is built from. */
  mostAbundant: IsotopeEntry;
  /** Σ abundance × mass for this composition (not the CIAAW standard atomic weight). */
  averageMass: number;
}

/** "1 007825.031898" (µu, as printed in AME2020) → 1.007825031898 u. */
export function parseAmeMicroU(s: string): number {
  const t = s.replace(/\s+/g, "");
  if (!/^\d+\.\d+$/.test(t)) throw new Error(`Not an AME2020 mass: ${s}`);
  return Number(t) / 1e6;
}

/** "0.05845(105)" → 0.05845; "1" → 1; returns NaN for anything else. */
export function parseCompositionValue(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(?:\(\d+\))?$/.exec(s.trim());
  return m ? Number(m[1]) : NaN;
}

/** "[0.99972, 0.99999]" → [0.99972, 0.99999], else null. */
export function parseInterval(s: string): [number, number] | null {
  const m = /^\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const TABLE: Map<string, ElementIsotopes> = (() => {
  const raw = new Map<string, { Z: number; rows: IsotopeEntry[]; interval: boolean }>();
  for (const line of ISOTOPE_ROWS.split("\n")) {
    const [z, sym, a, mass, ciaaw, nist] = line.split("|");
    const interval = parseInterval(ciaaw);
    let value = interval ? parseCompositionValue(nist) : parseCompositionValue(ciaaw);
    // A NIST value OUTSIDE the CIAAW interval is not used: the interval is the
    // 2024 evaluation, and a value it excludes would mix editions silently. The
    // interval's midpoint stands in, and intervalFallback says so. (One isotope
    // hits this: ³⁶S, NIST 0.0001(1) against CIAAW [0.000129, 0.000187].)
    let fallback = false;
    if (interval && !(value >= interval[0] && value <= interval[1])) {
      value = (interval[0] + interval[1]) / 2;
      fallback = true;
    }
    if (!Number.isFinite(value)) throw new Error(`isotopes.ts: no value for ${sym}-${a}`);
    const e = raw.get(sym) ?? { Z: Number(z), rows: [], interval: false };
    e.rows.push({
      A: Number(a),
      mass: parseAmeMicroU(mass),
      abundance: value,
      ciaaw,
      ...(interval ? { nist, interval } : {}),
      ...(fallback ? { intervalFallback: true } : {}),
    });
    if (interval) e.interval = true;
    raw.set(sym, e);
  }
  const out = new Map<string, ElementIsotopes>();
  for (const [symbol, e] of raw) {
    // The printed values do not always sum to exactly 1 (rounding, and the
    // interval elements' NIST values); the pattern uses them normalised.
    const sum = e.rows.reduce((s, r) => s + r.abundance, 0);
    const isotopes = e.rows.map((r) => ({ ...r, abundance: r.abundance / sum }));
    let mostAbundant = isotopes[0];
    for (const i of isotopes) if (i.abundance > mostAbundant.abundance) mostAbundant = i;
    const averageMass = isotopes.reduce((s, i) => s + i.abundance * i.mass, 0);
    out.set(symbol, { symbol, Z: e.Z, isotopes, interval: e.interval, mostAbundant, averageMass });
  }
  return out;
})();

const LABELS: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const line of LABEL_ROWS.split("\n")) {
    const [, sym, a, mass] = line.split("|");
    m.set(`${sym}-${a}`, parseAmeMicroU(mass));
  }
  return m;
})();

const NO_STABLE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const line of NO_STABLE_ROWS.split("\n")) {
    const [, sym, a] = line.split("|");
    m.set(sym, a);
  }
  return m;
})();

/** The natural composition of an element, or null when it has none in the table. */
export function elementIsotopes(symbol: string): ElementIsotopes | null {
  return TABLE.get(symbol) ?? null;
}

/** Every element symbol with a composition, in Z order. */
export function tabulatedElements(): string[] {
  return [...TABLE.values()].sort((a, b) => a.Z - b.Z).map((e) => e.symbol);
}

/**
 * The exact mass of ONE named isotope (a natural one, or a stored radiolabel), or
 * null when no AME2020 mass for it is stored here.
 */
export function isotopeMass(symbol: string, A: number): number | null {
  const el = TABLE.get(symbol);
  const nat = el?.isotopes.find((i) => i.A === A);
  if (nat) return nat.mass;
  return LABELS.get(`${symbol}-${A}`) ?? null;
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/** ⁵⁴Fe — the display-contract form of an isotope. */
export function isotopeLabel(symbol: string, A: number): string {
  return `${String(A).replace(/\d/g, (d) => SUP[d])}${symbol}`;
}

/**
 * Why an element has no natural pattern or monoisotopic mass, BY NAME — or null
 * when it has a composition. Covers the eight Z ≤ 92 elements with no stable
 * isotope, Z > 92, and symbols that are not elements.
 */
export function elementRefusal(symbol: string): string | null {
  if (TABLE.has(symbol)) return null;
  const z = atomicNumber(symbol);
  const name = z ? elementName(z) : null;
  const who = name ? `${symbol} (${name.toLowerCase()})` : symbol;
  const longest = NO_STABLE.get(symbol);
  if (longest) {
    const A = Number(longest.replace(/[[\]]/g, ""));
    const example = [...LABELS.keys()].filter((k) => k.startsWith(`${symbol}-`)).map((k) => Number(k.split("-")[1]));
    const eg = example.includes(99) && symbol === "Tc" ? 99 : example.includes(A) ? A : example[0] ?? A;
    return (
      `${who} has no stable isotope, so it has no monoisotopic mass and no natural isotope pattern — ` +
      `its composition depends on the source. Name the isotope as SMILES, e.g. [${eg}${symbol}] for ${isotopeLabel(symbol, eg)}.`
    );
  }
  if (z && z > 92) {
    const whoZ = name ? `${symbol} (${name.toLowerCase()}, Z = ${z})` : `${symbol} (Z = ${z})`;
    return (
      `${whoZ} is beyond the isotope table: CIAAW gives natural compositions only up to uranium (Z = 92), ` +
      `so there is no monoisotopic mass or isotope pattern to give.`
    );
  }
  return `${symbol} is not an element with a natural isotopic composition in the table.`;
}

/** Exact mass of the most abundant isotope of an element, or null. */
export function monoisotopicElementMass(symbol: string): number | null {
  return TABLE.get(symbol)?.mostAbundant.mass ?? null;
}
