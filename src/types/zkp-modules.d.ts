// Ambient type declarations for zk-SNARK dependencies that do not ship types.

declare module 'snarkjs' {
  export namespace groth16 {
    function fullProve(
      input: Record<string, string | number | bigint>,
      wasmFile: string,
      zkeyFile: string,
      logger?: unknown
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    function verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  }
  const snarkjs: { groth16: typeof groth16 };
  export default snarkjs;
}

declare module 'circomlibjs' {
  export interface Poseidon {
    F: { toString(value: unknown): string };
    (inputs: string[] | bigint[]): unknown;
  }
  export function buildPoseidon(): Promise<Poseidon>;
}
