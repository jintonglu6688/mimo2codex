import { describe, it, expect } from "vitest";
import { detectNativeArch } from "../scripts/detectNativeArch.mjs";

// Mach-O thin 64-bit header: magic 0xFEEDFACF (little-endian on disk) + cputype.
// CPU_TYPE_X86_64 = 0x01000007, CPU_TYPE_ARM64 = 0x0100000C.
function machO(cputype: number): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cputype, 4);
  return b;
}

// PE/COFF: "MZ" + e_lfanew@0x3C → "PE\0\0" + Machine@(e_lfanew+4).
// IMAGE_FILE_MACHINE_AMD64 = 0x8664, IMAGE_FILE_MACHINE_ARM64 = 0xAA64.
function pe(machine: number): Buffer {
  const b = Buffer.alloc(256);
  b.write("MZ", 0, "latin1");
  const peOff = 128;
  b.writeUInt32LE(peOff, 0x3c);
  b.write("PE\0\0", peOff, "latin1");
  b.writeUInt16LE(machine, peOff + 4);
  return b;
}

// ELF: 0x7F 'ELF' + EI_CLASS + EI_DATA(1=LE) + e_machine@18.
// EM_X86_64 = 0x3E, EM_AARCH64 = 0xB7.
function elf(machine: number): Buffer {
  const b = Buffer.alloc(24);
  b[0] = 0x7f;
  b[1] = 0x45;
  b[2] = 0x4c;
  b[3] = 0x46;
  b[4] = 2; // ELFCLASS64
  b[5] = 1; // little-endian
  b.writeUInt16LE(machine, 18);
  return b;
}

describe("detectNativeArch", () => {
  it("detects x86_64 Mach-O as x64", () => {
    expect(detectNativeArch(machO(0x01000007))).toBe("x64");
  });

  it("detects arm64 Mach-O as arm64", () => {
    expect(detectNativeArch(machO(0x0100000c))).toBe("arm64");
  });

  it("detects x64 PE as x64", () => {
    expect(detectNativeArch(pe(0x8664))).toBe("x64");
  });

  it("detects arm64 PE as arm64", () => {
    expect(detectNativeArch(pe(0xaa64))).toBe("arm64");
  });

  it("detects x86_64 ELF as x64", () => {
    expect(detectNativeArch(elf(0x3e))).toBe("x64");
  });

  it("detects aarch64 ELF as arm64", () => {
    expect(detectNativeArch(elf(0xb7))).toBe("arm64");
  });

  it("returns unknown for unrecognized bytes", () => {
    expect(detectNativeArch(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBe("unknown");
  });

  it("returns unknown for too-short input", () => {
    expect(detectNativeArch(Buffer.from([0x7f]))).toBe("unknown");
  });
});
