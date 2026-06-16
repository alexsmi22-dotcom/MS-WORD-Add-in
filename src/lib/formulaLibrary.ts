// A categorized library of common formulas. Each entry's `expr` is written in the
// linear math syntax understood by mathParse.ts, so selecting one populates the
// Math input and inserts as a native Word equation (and previews via mathHtml).
//
// Syntax reminders: a/b fraction · x^2 / a_n super/subscript · sqrt(x), root(n,x)
// · sum(lo,hi,body) Σ · int(lo,hi,body) ∫ · prod, lim(x->0,body) · abs(x)/|x|
// · bar(x) hat(x) vec(x) accents · sin(x)…log/ln functions · n! factorial · +- → ±.

export interface Formula {
  label: string;
  expr: string;
}

export interface FormulaCategory {
  name: string;
  formulas: Formula[];
}

export const FORMULA_LIBRARY: FormulaCategory[] = [
  {
    name: "Statistics",
    formulas: [
      { label: "Sample mean", expr: "bar(x) = (1/n) sum(i=1, n, x_i)" },
      { label: "Sample variance", expr: "s^2 = (1/(n-1)) sum(i=1, n, (x_i - bar(x))^2)" },
      { label: "Sample standard deviation", expr: "s = sqrt((1/(n-1)) sum(i=1, n, (x_i - bar(x))^2))" },
      { label: "Population standard deviation", expr: "sigma = sqrt((1/N) sum(i=1, N, (x_i - mu)^2))" },
      { label: "Z-score", expr: "z = (x - mu)/sigma" },
      { label: "Standard error of the mean", expr: "SE = sigma/sqrt(n)" },
      {
        label: "Pearson correlation",
        expr:
          "r = sum(i=1, n, (x_i - bar(x))(y_i - bar(y))) / sqrt(sum(i=1, n, (x_i - bar(x))^2) sum(i=1, n, (y_i - bar(y))^2))",
      },
      { label: "Normal distribution (PDF)", expr: "f(x) = (1/(sigma sqrt(2 pi))) e^(-(x - mu)^2/(2 sigma^2))" },
      { label: "Combinations (n choose k)", expr: "C(n, k) = n!/(k!(n - k)!)" },
    ],
  },
  {
    name: "Geometry",
    formulas: [
      { label: "Area of a circle", expr: "A = pi r^2" },
      { label: "Circumference of a circle", expr: "C = 2 pi r" },
      { label: "Area of a triangle", expr: "A = (1/2) b h" },
      { label: "Heron's formula", expr: "A = sqrt(s(s - a)(s - b)(s - c))" },
      { label: "Pythagorean theorem", expr: "c = sqrt(a^2 + b^2)" },
      { label: "Distance between two points", expr: "d = sqrt((x_2 - x_1)^2 + (y_2 - y_1)^2)" },
      { label: "Slope of a line", expr: "m = (y_2 - y_1)/(x_2 - x_1)" },
      { label: "Volume of a sphere", expr: "V = (4/3) pi r^3" },
      { label: "Volume of a cylinder", expr: "V = pi r^2 h" },
      { label: "Volume of a cone", expr: "V = (1/3) pi r^2 h" },
    ],
  },
  {
    name: "Algebra",
    formulas: [
      { label: "Quadratic formula", expr: "x = (-b +- sqrt(b^2 - 4 a c))/(2 a)" },
      { label: "Slope-intercept line", expr: "y = m x + b" },
      { label: "Difference of squares", expr: "a^2 - b^2 = (a - b)(a + b)" },
      { label: "Square of a binomial", expr: "(a + b)^2 = a^2 + 2 a b + b^2" },
      { label: "Product of powers", expr: "a^m a^n = a^(m + n)" },
      { label: "Logarithm of a product", expr: "log(x y) = log(x) + log(y)" },
      { label: "Change of base", expr: "log_b(x) = ln(x)/ln(b)" },
    ],
  },
  {
    name: "Trigonometry",
    formulas: [
      { label: "Pythagorean identity", expr: "sin(x)^2 + cos(x)^2 = 1" },
      { label: "Tangent definition", expr: "tan(x) = sin(x)/cos(x)" },
      { label: "Sine double angle", expr: "sin(2 x) = 2 sin(x) cos(x)" },
      { label: "Cosine double angle", expr: "cos(2 x) = cos(x)^2 - sin(x)^2" },
      { label: "Sine angle addition", expr: "sin(a + b) = sin(a) cos(b) + cos(a) sin(b)" },
      { label: "Law of cosines", expr: "c^2 = a^2 + b^2 - 2 a b cos(C)" },
      { label: "Law of sines", expr: "a/sin(A) = b/sin(B) = c/sin(C)" },
    ],
  },
  {
    name: "Calculus",
    formulas: [
      { label: "Derivative (limit definition)", expr: "(df)/(dx) = lim(h -> 0, (f(x + h) - f(x))/h)" },
      { label: "Power rule", expr: "(d/dx) x^n = n x^(n - 1)" },
      { label: "Fundamental theorem", expr: "int(a, b, f(x)) = F(b) - F(a)" },
      { label: "Sum of first n integers", expr: "sum(i=1, n, i) = n(n + 1)/2" },
      { label: "Geometric series", expr: "sum(n=0, infinity, r^n) = 1/(1 - r)" },
      { label: "Definition of e", expr: "e = lim(n -> infinity, (1 + 1/n)^n)" },
    ],
  },
];
