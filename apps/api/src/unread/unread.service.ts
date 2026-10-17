import { Injectable } from "@nestjs/common";
import { UnreadRepository } from "./unread.repository";
import type { UnreadCounts } from "./unread.types";

/**
 * The count with no write before it — what the stream's opening `sync` restates. The writes
 * count inside their own transactions through `countUnreadOf`, so this is the one reader
 * outside a repository, and the layer the controller talks to.
 */
@Injectable()
export class UnreadService {
  constructor(private readonly unreadRepository: UnreadRepository) {}

  count(userId: string): Promise<UnreadCounts> {
    return this.unreadRepository.count(userId);
  }
}
