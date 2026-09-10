import { AccessToken } from "livekit-server-sdk";

export interface InterviewTokenInput {
  userId: string;
  interviewId: string;
  roomName: string;
  categoryId: string;
  difficulty: string;
  durationS: number;
}

/**
 * Single place both the creation route and the reconnect/reissue route mint
 * a token from — keeps the grant and attributes identical between "join for
 * the first time" and "rejoin after a refresh".
 *
 * canPublishData is true (not the earlier false) so the browser can send the
 * one control message this milestone needs: an explicit "end interview"
 * signal the agent listens for and turns into runner.requestEnd() — the
 * graceful CLOSING path, not a bare disconnect treated as an abandoned
 * session.
 */
export async function mintInterviewToken(input: InterviewTokenInput): Promise<string> {
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity: `candidate_${input.userId}`,
      // Slightly longer than the interview so a reconnect near the end still
      // has a valid token.
      ttl: "25m",
      attributes: {
        interviewId: input.interviewId,
        categoryId: input.categoryId,
        difficulty: input.difficulty,
        durationS: String(input.durationS),
      },
    },
  );
  token.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,     // microphone
    canSubscribe: true,   // agent audio + its published UI-state data
    canPublishData: true, // the candidate's one control message: end_interview
  });
  return token.toJwt();
}
