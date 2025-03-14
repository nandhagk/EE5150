from asyncio import Event, Queue, get_running_loop, sleep, wait_for
from asyncio.futures import Future
from asyncio.protocols import DatagramProtocol
from asyncio.transports import DatagramTransport
from itertools import pairwise
from logging import DEBUG, INFO, FileHandler, Formatter, StreamHandler, getLogger
from math import ceil, log
from statistics import mean
from struct import pack, unpack
from time import time
from typing import TypeAlias

try:
    from uvloop import run
except ImportError:
    from asyncio import run

logger = getLogger(__name__)
logger.setLevel(DEBUG)

fh = FileHandler("client.log")
fh.setLevel(DEBUG)

ch = StreamHandler()
ch.setLevel(INFO)

formatter = Formatter("%(asctime)s | %(levelname)-8s | %(message)s")
fh.setFormatter(formatter)
ch.setFormatter(formatter)

logger.addHandler(fh)
logger.addHandler(ch)

Seq: TypeAlias = int
Timestamp: TypeAlias = float
Ack: TypeAlias = tuple[Timestamp, Seq]

ALPHA = 0.1


def find_s(buf: int, p: float) -> int:
    if p == 0:
        return 1

    L = log(1 / buf) / log(p) * (1 + ALPHA)
    R = 10

    def f(x):
        return x / (1 - buf * p**x)

    while R - L > 0.1:
        M1 = (2 * L + R) / 3
        M2 = (L + 2 * R) / 3

        F1 = f(M1)
        F2 = f(M2)

        if F1 < F2:
            R = M2
        else:
            L = M1

    return round(R)


class RTPClientProtocol(DatagramProtocol):
    def __init__(self, on_con_lost: Future[bool]):
        self.on_con_lost = on_con_lost
        self.transport: DatagramTransport | None = None

        self.prv = 1
        self.acks: list[Ack] = [(-float("inf"), -1)]
        self.queue: Queue[Seq] = Queue()

        self.ack1 = Event()
        self.ack2 = Event()

        self.sent = 0

    def connection_made(self, transport):
        self.transport = transport
        logger.info("Established connection")

        loop = get_running_loop()
        loop.create_task(self.serve())
        loop.create_task(self.blast_off())

    async def blast_off(self):
        assert self.transport is not None

        start = time()
        # If we are unable to get rtt, then no packet is getting through
        rtt, prc = await self.estimate_latency()
        while rtt == float("inf"):
            rtt, prc = await self.estimate_latency()

        logger.info("Estimated rtt: %f, prc: %f", rtt, prc)
        if prc == float("inf"):
            # TODO: Handle high packet loss
            return

        buf = await self.estimate_buffer(rtt, prc)
        logger.info("Estimated buf: %d", buf)

        await self.profit(rtt, prc, buf)

        end = time()
        logger.info("Sent all packets: %f", end - start)

        self.transport.close()

    async def estimate_latency(self):
        self.ack1.clear()
        self.ack2.clear()

        TIMEOUT = 10
        PACKET_SEND_COUNT = 8

        started_at = time()

        seq = self.acks[-1][1]
        self.prv = len(self.acks)
        for _ in range(PACKET_SEND_COUNT):
            self.queue.put_nowait(seq + 1)

        await wait_for(self.ack1.wait(), TIMEOUT)
        if len(self.acks) - self.prv < 1:
            logger.error("Extremely high packet loss detected")
            return float("inf"), float("inf")

        ack1 = self.acks[self.prv + 0][0]
        rtt = ack1 - started_at

        await wait_for(self.ack2.wait(), TIMEOUT)
        if len(self.acks) - self.prv < 2:
            logger.error("High packet loss detected")
            return rtt, float("inf")

        # Could be higher than actual processing time if packet loss is non-zero
        ack2 = self.acks[self.prv + 1][0]
        prc = ack2 - ack1

        # Clear out server buffer
        in_buffer = PACKET_SEND_COUNT - (len(self.acks) - self.prv)
        await sleep(in_buffer * prc * (1 + ALPHA))

        prc = mean(b[0] - a[0] for a, b in pairwise(self.acks[self.prv :]))
        return rtt, prc

    async def estimate_buffer(self, rtt: float, prc: float):
        BURST_DROP = 8

        REQUIRED_BUFFER_SIZE = ceil((rtt + prc) / prc)

        # Assuming that drop rate < 25%
        PACKET_SEND_COUNT = ceil(3 * REQUIRED_BUFFER_SIZE / 2)

        sel = self.acks[-1][1]
        prv = len(self.acks)
        for seq in range(sel + 1, sel + PACKET_SEND_COUNT + 1):
            self.queue.put_nowait(seq)

        # Clear out server buffer
        await sleep((rtt + PACKET_SEND_COUNT * prc) * (1 + ALPHA))

        end = time()

        current_buf = 0
        buffer_size = min(REQUIRED_BUFFER_SIZE, len(self.acks) - prv)

        for a, b in pairwise(self.acks[prv:]):
            if b[0] - a[0] >= BURST_DROP * prc:
                buffer_size = min(buffer_size, current_buf + 1)
                current_buf = 0
            else:
                current_buf += 1

        if end - self.acks[-1][0] >= BURST_DROP * prc:
            buffer_size = min(buffer_size, current_buf + 1)

        return buffer_size

    async def profit(self, rtt: float, prc: float, buf: int):
        T0 = 1000
        interval = max(prc, (rtt + prc) / buf)

        """
        m0 = T0 * (p^s)
        T1 = T0 + m0 * buf
        m1 = T1 * (p^s)
           = T0 * (1 + buf * (p^s)) * (p^s)
           = T0 * (p^s + buf * p^2s)
           = T0 * ((buf * p^s) + (buf * p^s)^2) / buf
        TI = T0 / (1 - buf * p^s)
        total = TI * s * prc
        """

        p = 0
        seq = self.acks[-1][1]

        precv = len(self.acks)
        psent = self.sent

        last_correct = time()
        while self.acks[-1][1] < T0:
            recv = len(self.acks) - precv
            sent = self.sent - psent
            if sent > 0:
                p = max(0, (1 - (recv + buf) / sent))

            s = find_s(buf, p)
            seq += 1

            logger.debug("Sending: %d with count: %d and drop: %f", seq, s, p)
            for _ in range(s):
                self.queue.put_nowait(seq)
                if (
                    time() - last_correct >= rtt * (1 + ALPHA)
                    and self.acks[-1][1] == self.acks[-2 - s][1]
                ):
                    seq = self.acks[-1][1]
                    last_correct = time()
                    break

                await sleep(interval * (1 + ALPHA))

    def datagram_received(self, data: bytes, _):
        assert len(data) == 4  # HOW?!

        received_at: Timestamp = time()
        seq: Seq = unpack("!I", data)[0]

        self.acks.append((received_at, seq))

        if len(self.acks) - self.prv == 1:
            self.ack1.set()
        elif len(self.acks) - self.prv == 2:
            self.ack2.set()

        logger.debug("Received: %s", seq)

    def error_received(self, exc):
        logger.exception("Error received:", exc_info=exc)

    def connection_lost(self, exc):
        logger.warning("Connection closed")
        self.on_con_lost.set_result(True)

    async def serve(self):
        while True:
            seq = await self.queue.get()
            self.send(seq)
            self.queue.task_done()

    def send(self, seq: Seq):
        assert self.transport is not None

        _, last_ack = self.acks[-1]
        if last_ack + 1 > seq:
            logger.warning("Attempted to send acknowledged packet: %d", seq)
            seq = last_ack + 1

        data = pack("!I", seq)
        self.transport.sendto(data)

        self.sent += 1
        logger.debug("Sent: %d", seq)


async def main():
    loop = get_running_loop()

    on_con_lost: Future[bool] = loop.create_future()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: RTPClientProtocol(on_con_lost),  # type: ignore
        remote_addr=("127.0.0.1", 12000),
    )

    try:
        await on_con_lost
    finally:
        transport.close()


if __name__ == "__main__":
    run(main())
