"""
Authors:
    Nandha Gopi Krishna CS23B044
    Kaushik G Iyer EE23B135

    Github:
    https://github.com/nandhagk/EE5150/tree/main/rtpudp
"""

import math
import queue
import socket
import struct
import threading
import time

type Seq = int
type Timestamp = float
type Ack = tuple[Timestamp, Seq]

# TODO: Review the logix
# Consider adding some deltas to the sleeps made (Just to account for any minute delays)


class UDPClient:
    def __init__(self, address: tuple[str, int]):
        self.__sock = socket.socket(
            socket.AddressFamily.AF_INET, socket.SocketKind.SOCK_DGRAM
        )
        self.__address = address
        self.__is_running = False

        self.__listen_thread: threading.Thread
        self.__service_thread: threading.Thread

        self.send_queue = queue.Queue[Seq | None]()

        self.acks: list[Ack] = []
        self.last_ack: Seq = -1

        self.two_message_arrive_event = threading.Event()

        self.listen_ready = threading.Event()

        self.start_polling: bool = False
        self.total_sends = 0
        self.total_recs = 0

    def _service_loop(self):
        """
        Handles sending messages to the server.
        NOTE: The functional will try to ensure that already acked sequences are not sent!
        """

        while self.__is_running:
            seq = self.send_queue.get()

            if seq is None:
                break

            try:
                self.__sock.sendto(
                    struct.pack("!I", max(self.last_ack + 1, seq)), self.__address
                )

                if self.start_polling:
                    self.total_sends += 1

                self.listen_ready.set()
            except Exception:
                ...

        self.stop()

    def _listen(self):
        """Listens for responses from the server"""
        self.listen_ready.wait()
        while self.__is_running:
            try:
                response, _server_address = self.__sock.recvfrom(2048)
                if len(response) != 4:
                    return

                seq: Seq = struct.unpack("!I", response)[0]
                if self.start_polling:
                    self.total_recs += 1

                self.last_ack = seq
                print("RECEIVED ACK", seq, flush=True)
                self.acks.append((time.time(), seq))

                if len(self.acks) == 2:
                    self.two_message_arrive_event.set()

            except socket.error as e:  # If the socket closed abruptly
                print(e)  # TODO: Figure out expected behaviour here, flush=True!
                self.stop()

    def stop(self):
        """Stops listening for responses"""
        if not self.__is_running:
            return

        self.__is_running = False
        self.send_queue.put(None)

        try:
            self.__sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            print("HI", flush=True)

        self.__sock.close()

    def run(self) -> bool:
        """
        Spawns thread to serve and listen
        """

        self.__is_running = True
        self.__listen_thread = threading.Thread(target=self._listen, daemon=True)
        self.__service_thread = threading.Thread(target=self._service_loop, daemon=True)

        self.__listen_thread.start()
        self.__service_thread.start()

        return self.main()

    def cleanup(self):
        """"""
        self.stop()
        self.__listen_thread.join()
        self.__service_thread.join()

    def estimate_delays(self) -> tuple[float, float]:
        """
        STAGE 1!

        We estimate the rtt and the processing delay.
        NOTE: For this to work we required that atleast 2 packets are served succesfully
        """

        PACKET_SEND_COUNT = 8
        # Assuming the drop probability is <25%,
        # the probability that atleast 2 packets are successfully served is > TODO%

        start_time = time.time()
        for _ in range(PACKET_SEND_COUNT):
            self.send_queue.put(0)

        # TODO: Provide a resonable timeout to giveup (or try again ???)
        self.two_message_arrive_event.wait()

        first_ack = self.acks[0][0]  # Approximately rtt
        second_ack = self.acks[1][0]  # Approximately rtt + proc

        proc = second_ack - first_ack
        rtt = first_ack - start_time

        # NOTE: There still might be packets being processed by the previous stage here!
        # We just sleep to ensure the buffer is empty
        remaining_packets = PACKET_SEND_COUNT - len(self.acks)
        time.sleep(proc * remaining_packets)

        return rtt, proc

    def estimate_buffer(self, rtt: float, processing_delay: float) -> int:
        """
        STAGE 2!

        We estimate the buffer size.
        (or we figure out that it is sufficiently big enough)

        NOTE: We expect the server queue to be empty!
        """
        print("ESTIMATING", rtt, processing_delay, flush=True)

        REQUIRED_BUFFER_SIZE = math.ceil((rtt + processing_delay) / processing_delay)
        """The buffer size required by us (More about this in `self.profit`)"""

        PACKET_SEND_COUNT = 2 * REQUIRED_BUFFER_SIZE
        print(REQUIRED_BUFFER_SIZE, PACKET_SEND_COUNT, flush=True)
        # To get a decent idea of the buffer size, we need to fill it to the max
        # Since we are happy with the REQUIRED_BUFFER_SIZE, we only need calculate till that point
        # But to account for any minute errors, we go uptil 1.5 * the required

        start_time: Timestamp = time.time()
        last_ack = self.last_ack

        for i in range(PACKET_SEND_COUNT):
            self.send_queue.put(last_ack + i + 1)

        # We don't expect any packets to arrive by now
        time.sleep(rtt)

        # Since some missing packets can be caused by the drop chance (and not buffer full)
        # We devised the below method :)

        contiguous_missing_packet_count = 0
        previous_acks_count = len(self.acks)

        for _ in range(PACKET_SEND_COUNT):
            # We will expect a packet once every processing delay from now

            acks_count = len(self.acks)
            if acks_count == previous_acks_count:
                contiguous_missing_packet_count += 1
            else:
                contiguous_missing_packet_count = 0

            previous_acks_count = acks_count
            # If we get 8 missing packets continuously, we expect this TODO (write probability) to be because of buffer full
            if contiguous_missing_packet_count >= 8:
                buffer_size = round(
                    (self.acks[-1][0] - start_time - rtt) / processing_delay
                )
                return buffer_size

            time.sleep(processing_delay)
        # If we did not get buffer losses till here, we can confidently say our buffer is big enough :)

        return REQUIRED_BUFFER_SIZE

    def profit(self, rtt: float, processing_delay: float, buffer_size: int):
        """
        STAGE 3!

        Everything is known, our hard work has paid off. Tis now the time to take advantage of our knowledge
        """
        print("PROFIT", processing_delay, buffer_size, flush=True)

        # Ideally we want to send messages every processing delay
        # (Sending any faster doesn't really provide any advantages)
        # But notice that we also do not want to fill up the buffer and get buffer losses!

        sending_interval = max(processing_delay, (processing_delay + rtt) / buffer_size)
        # (processing_delay + rtt) / buffer_size is the minimum interval we can place while ensuring no buffer loss

        self.start_polling = True
        drop_chance = 0

        start_time = time.time()

        seq = self.last_ack + 1
        while self.last_ack < 1000:
            # Send the remaining packets

            # TODO: Account for race conditions!
            if (
                time.time() - start_time >= rtt * 1.05
                and self.acks[-1][1] == self.acks[-3][1]
                and self.acks[-1][1] == self.acks[-2][1]
            ):
                print("TRIPLE ACK", self.acks[-1][1], flush=True)
                # Whenever we perceive a triple ack we reset our sequence number
                seq = self.acks[-1][1] + 1
                time.sleep(rtt * 1.05)  # Let the buffer clear

            # TODO: We can actually be smarter about when to reset our sequence number!

            if self.total_sends > 10:
                in_buffer = seq - self.acks[-1][1]
                drop_chance = max(
                    1 - (self.total_recs + in_buffer) / (self.total_sends), 0
                )

            # A nice heuristic we discovered :)
            send_count = round(
                math.exp(drop_chance / (1 - min(drop_chance, 0.9))) * 6 - 5
            )

            print(
                drop_chance,
                send_count,
                send_count * (1 - drop_chance),
                self.total_recs,
                self.total_sends,
            )
            # We keep incrementally sending data
            for _ in range(send_count):
                self.send_queue.put(seq)

            time.sleep(sending_interval * 1.05 * send_count)
            seq += 1

    def main(self) -> bool:
        """
        The function called after the client has started running.
        Return True if sucessful :)
        """
        # Stage 1:
        rtt, proc = self.estimate_delays()
        print(rtt, proc, flush=True)

        # Stage 2:
        buffer_size = self.estimate_buffer(rtt, proc)
        print(buffer_size, flush=True)

        # Stage 3:
        self.profit(rtt, proc, buffer_size)

        return True


client = UDPClient(("127.0.0.1", 12000))

t0 = time.time()
success = client.run()

if success:
    t1 = time.time()
    print("TIME TAKEN!", t1 - t0, flush=True)
else:
    print("SOMETHING VERY BAD HAPPENED!", flush=True)
# Measure here ig :)

client.cleanup()
