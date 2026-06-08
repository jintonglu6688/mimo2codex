// Detect the CPU architecture of a native binary (.node / .so / .dylib / .exe)
// by parsing its file header — Mach-O (macOS), PE/COFF (Windows), ELF (Linux).
// Returns "x64" | "arm64" | "unknown". Pure function, no I/O.
//
// Why parse statically instead of executing the module: a cross-arch build
// (e.g. an arm64 CI runner producing the x64 package) can't *run* the foreign
// binary to ABI-check it, but it CAN read the header. This lets the sidecar
// build fail loudly when the wrong-arch prebuild was fetched — the root cause
// of issue #69, where the macOS x64 package shipped an arm64 better-sqlite3.

export function detectNativeArch(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return "unknown";

  // --- Mach-O thin 64-bit (macOS): magic 0xFEEDFACF then cputype ---
  if (buf.readUInt32LE(0) === 0xfeedfacf) {
    const cputype = buf.readUInt32LE(4);
    if (cputype === 0x01000007) return "x64"; // CPU_TYPE_X86_64
    if (cputype === 0x0100000c) return "arm64"; // CPU_TYPE_ARM64
    return "unknown";
  }

  // --- PE/COFF (Windows): "MZ" → e_lfanew@0x3C → "PE\0\0" → Machine ---
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    if (buf.length < 0x40) return "unknown";
    const peOff = buf.readUInt32LE(0x3c);
    if (buf.length < peOff + 6) return "unknown";
    if (buf[peOff] === 0x50 && buf[peOff + 1] === 0x45) {
      const machine = buf.readUInt16LE(peOff + 4);
      if (machine === 0x8664) return "x64"; // IMAGE_FILE_MACHINE_AMD64
      if (machine === 0xaa64) return "arm64"; // IMAGE_FILE_MACHINE_ARM64
    }
    return "unknown";
  }

  // --- ELF (Linux): 0x7F 'ELF' → e_machine@18 (endianness per EI_DATA) ---
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    if (buf.length < 20) return "unknown";
    const littleEndian = buf[5] === 1;
    const machine = littleEndian ? buf.readUInt16LE(18) : buf.readUInt16BE(18);
    if (machine === 0x3e) return "x64"; // EM_X86_64
    if (machine === 0xb7) return "arm64"; // EM_AARCH64
  }

  return "unknown";
}
