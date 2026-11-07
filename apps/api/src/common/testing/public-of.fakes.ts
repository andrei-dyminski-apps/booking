/**
 * A homomorphic mapped type keeps only the public surface of a class — private members are
 * not part of `keyof`. So a fake can stand in for a repository without extending it, and
 * still stops compiling the moment the real one gains or drops a method, or changes what
 * one returns.
 *
 * What it does not catch is a parameter added to an existing method, or one whose type is
 * widened: a shorter signature stays assignable to a longer one, and method parameters are
 * compared bivariantly even under `strictFunctionTypes`. A changed argument list therefore
 * has to be carried into the fakes by hand.
 *
 * Kept out of the build by `tsconfig.build.json` (`*.fakes.ts`).
 */
export type PublicOf<T> = { [K in keyof T]: T[K] };
