import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Booking, CreateBookingInput } from "@repo/contracts";
import type { Booking as BookingRow } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Booking[]> {
    const rows = await this.prisma.booking.findMany({
      orderBy: { from: "asc" },
    });

    return rows.map(toBooking);
  }

  async findOne(id: string): Promise<Booking> {
    const row = await this.prisma.booking.findUnique({ where: { id } });

    if (row === null) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    return toBooking(row);
  }

  async create(input: CreateBookingInput): Promise<Booking> {
    // The check and the insert are not atomic — phase 4 of the plan closes the
    // race between concurrent requests (transaction + EXCLUDE constraint in the DB).
    const conflict = await this.prisma.booking.findFirst({
      where: {
        roomId: input.roomId,
        from: { lt: new Date(input.to) },
        to: { gt: new Date(input.from) },
      },
    });

    if (conflict !== null) {
      throw new ConflictException(
        `Room ${input.roomId} is already booked from ${toIsoDate(conflict.from)} to ${toIsoDate(conflict.to)}`,
      );
    }

    const row = await this.prisma.booking.create({
      data: {
        roomId: input.roomId,
        guestName: input.guestName,
        from: new Date(input.from),
        to: new Date(input.to),
      },
    });

    return toBooking(row);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.booking.deleteMany({ where: { id } });

    if (count === 0) {
      throw new NotFoundException(`Booking ${id} not found`);
    }
  }
}

/** @db.Date columns arrive as a Date at UTC midnight, so slicing the ISO string is exact. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    roomId: row.roomId,
    guestName: row.guestName,
    from: toIsoDate(row.from),
    to: toIsoDate(row.to),
    createdAt: row.createdAt.toISOString(),
  };
}
