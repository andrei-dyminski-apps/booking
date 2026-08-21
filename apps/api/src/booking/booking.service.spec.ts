import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { CreateBookingInput } from "@repo/contracts";
import type { Booking as BookingRow } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BookingService } from "./booking.service";

const input: CreateBookingInput = {
  roomId: "101",
  guestName: "Anna",
  from: "2026-09-01",
  to: "2026-09-05",
};

const row: BookingRow = {
  id: "0b6f7f6e-2f4c-4a52-9a5e-8f1f6d2c3b4a",
  roomId: "101",
  guestName: "Anna",
  from: new Date("2026-09-01"),
  to: new Date("2026-09-05"),
  createdAt: new Date("2026-08-17T12:00:00.000Z"),
};

// The date overlap is checked by the SQL query, so unit tests cover the service
// logic around it: mapping rows to the contract and turning DB answers into HTTP errors.
// The overlap semantics themselves are covered by e2e tests against a real database.
const prismaService = {
  booking: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe("BookingService", () => {
  let service: BookingService;

  beforeEach(async () => {
    // resetAllMocks, not clearAllMocks: the latter keeps mockResolvedValue in place,
    // so a stub from one test would leak into the next.
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = moduleRef.get(BookingService);
  });

  it("creates a booking and converts dates into the contract format", async () => {
    prismaService.booking.findFirst.mockResolvedValue(null);
    prismaService.booking.create.mockResolvedValue(row);

    const booking = await service.create(input);

    expect(booking).toMatchObject(input);
    expect(booking.id).toBe(row.id);
    expect(booking.createdAt).toBe(row.createdAt.toISOString());
  });

  it("queries overlaps with strict inequalities, so back-to-back bookings pass", async () => {
    prismaService.booking.findFirst.mockResolvedValue(null);
    prismaService.booking.create.mockResolvedValue(row);

    await service.create(input);

    expect(prismaService.booking.findFirst).toHaveBeenCalledWith({
      where: {
        roomId: input.roomId,
        from: { lt: new Date(input.to) },
        to: { gt: new Date(input.from) },
      },
    });
  });

  it("rejects creation when an overlapping booking is found", async () => {
    prismaService.booking.findFirst.mockResolvedValue(row);

    await expect(service.create(input)).rejects.toThrow(ConflictException);
    expect(prismaService.booking.create).not.toHaveBeenCalled();
  });

  it("findAll sorts by check-in date and maps rows to the contract", async () => {
    prismaService.booking.findMany.mockResolvedValue([row]);

    const bookings = await service.findAll();

    expect(prismaService.booking.findMany).toHaveBeenCalledWith({
      orderBy: { from: "asc" },
    });
    expect(bookings).toEqual([
      {
        id: row.id,
        roomId: row.roomId,
        guestName: row.guestName,
        from: "2026-09-01",
        to: "2026-09-05",
        createdAt: row.createdAt.toISOString(),
      },
    ]);
  });

  it("throws NotFoundException for an unknown id", async () => {
    prismaService.booking.findUnique.mockResolvedValue(null);
    prismaService.booking.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.findOne(row.id)).rejects.toThrow(NotFoundException);
    await expect(service.remove(row.id)).rejects.toThrow(NotFoundException);
  });
});
