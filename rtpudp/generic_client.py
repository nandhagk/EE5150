import socket
import struct
import threading

import queue
import time
import math

type Seq = int
type Timestamp = float
type Ack = tuple[Timestamp, Seq]

# TODO: Review the logix
# Consider adding some deltas to the sleeps made (Just to account for any minute delays)


class UDPClient:
    def __init__(self, address: tuple[str, int]):
        self.__sock = socket.socket(socket.AddressFamily.AF_INET, socket.SocketKind.SOCK_DGRAM)
        self.__address = address
        self.__is_running = False
        
        self.__listen_thread: threading.Thread
        self.__service_thread: threading.Thread

        self.send_queue = queue.Queue[Seq | None]()

        self.acks: list[Ack] = []
        self.last_ack: Seq = -1

        # TODO: Figure out a way to establish the connection!
        # Since the socket doesn't like receiving until a message is sent


    def _service_loop(self):
        """
        Handles sending messages to the server.
        NOTE: The functional will try to ensure that already acked sequences are not sent!
        """

        while self.__is_running:
            seq = self.send_queue.get()  

            if seq is None: 
                break

            self.__sock.sendto(struct.pack("!I", max(self.last_ack + 1, seq)), self.__address)
                   
        self.stop()

    def _listen(self):
        """Listens for responses from the server"""
        self.__is_running = True

        while self.__is_running:
            try:
                response, _server_address = self.__sock.recvfrom(2048)
                seq: Seq = struct.unpack("!I", response)[0]

                self.last_ack = seq
                self.acks.append((time.time(), seq))


            except socket.error as e: # If the socket closed abruptly
                print(e) # TODO: Figure out expected behaviour here!
                self.stop()

    def stop(self):
        """Stops listening for responses"""
        if not self.__is_running:
            return

        self.__is_running = False
        self.send_queue.put(None)
        self.__sock.shutdown(socket.SHUT_RDWR)
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
        ""
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
        last_ack = self.last_ack

        for i in range(PACKET_SEND_COUNT):
            self.send_queue.put(last_ack + i + 1)

        # TODO: Sleep until list size > 2

        first_ack = self.acks[0][0] # Approximately rtt + proc
        second_ack = self.acks[1][0] # Approximately rtt + 2 * proc

        proc = second_ack - first_ack
        rtt = first_ack - start_time - proc

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
        
        REQUIRED_BUFFER_SIZE = math.ceil((rtt + processing_delay) / processing_delay)
        """The buffer size required by us (More about this in `self.profit`)"""

        PACKET_SEND_COUNT = (REQUIRED_BUFFER_SIZE * 3) // 2
        # To get a decent idea of the buffer size, we need to fill it to the max
        # Since we are happy with the REQUIRED_BUFFER_SIZE, we only need calculate till that point
        # But to account for any minute errors, we go uptil 1.5 * the required


        start_time = time.time()
        last_ack = self.last_ack

        for i in range(PACKET_SEND_COUNT):
            self.send_queue.put(last_ack + i + 1)

        # Sleep until we expect all the sent packets to be received
        time.sleep(rtt + processing_delay * PACKET_SEND_COUNT)

        # We expect that the last packets that we send will be dropped due to the buffer begin full
        # Therefore the last ack we receive approximately tells us the size of the buffer
        # (It is the last packet to be allowed on the buffer)
        buffer_size = math.floor((self.acks[-1][0] - start_time - rtt) / processing_delay)
        
        return buffer_size
    
    def profit(self, rtt: float, processing_delay: float, buffer_size: int):
        """
        STAGE 3!
        
        Everything is known, our hard work has paid off. Tis now the time to take advantage of our knowledge
        """
        
        # Ideally we want to send messages every processing delay
        # (Sending any faster doesn't really provide any advantages)
        # But notice that we also do not want to fill up the buffer and get buffer losses!

        sending_interval = max(processing_delay, (processing_delay + rtt) / buffer_size)
        # (processing_delay + rtt) / buffer_size is the minimum interval we can place while ensuring no buffer loss
        # TODO: Account for small delta errors
        

        seq = self.last_ack + 1
        while self.last_ack < 10_000:
            # Send the remaining packets
            time.sleep(sending_interval)
            
            # TODO: Account for race conditions!
            if (self.acks[-1][1] == self.acks[-2][1]):
                # Whenever we percieve a double ack we reset our sequence number
                seq = self.acks[-1][1] + 1

            # TODO: We can actually be smarter about when to reset our sequence number!


            # We keep incrementally sending data
            self.send_queue.put(seq)
            seq += 1
        

    def main(self) -> bool:
        """
        The function called after the client has started running.
        Return True if sucessful :)
        """
        # Stage 1:
        rtt, proc = self.estimate_delays()
        
        # Stage 2:
        buffer_size = self.estimate_buffer(rtt, proc)
        
        # Stage 3:
        self.profit(rtt, proc, buffer_size)

        return True


client = UDPClient(("127.0.0.1", 12000))

success = client.run()

if (success):
    print("TIME TAKEN!")
else:
    print("SOMETHING VERY BAD HAPPENED!")
# Measure here ig :)

client.cleanup()