import socket
import struct
import threading

from time import sleep


class UDPClient:
    def __init__(self, address: tuple[str, int]):
        self.__sock = socket.socket(socket.AddressFamily.AF_INET, socket.SocketKind.SOCK_DGRAM)
        self.__address = address

        self.__is_listening = False

        self.acks_till_date = [-1]

        self.send(0)

    def send(self, seq: int):
        """Sends a message (That only contains the sequence number provided in big endian format)"""
        self.__sock.sendto(struct.pack("!I", seq), self.__address)    
    
    def _serve(self):
        """
        Function called on a seperate thread.
        NOTE: You proabably only want to serve while the client is listening!
        """
        ACK_GOAL = 100

        while self.__is_listening:
            ack = self.acks_till_date[-1]
            print(ack)

            if ack >= ACK_GOAL:
                self.stop()
                return     

            for seq in range(ack + 1, ack + 10):
                self.send(seq)

            sleep(0.5)
                   

        self.stop()            

    def _listen(self):
        """Listens for responses from the server"""
        self.__is_listening = True

        while self.__is_listening:
            try:
                response, _server_address = self.__sock.recvfrom(2048)
                ack = struct.unpack("!I", response)[0]

                self.acks_till_date.append(ack) # Apparently python list.append is thread safe :)

            except socket.error as e: # If the socket closed abruptly
                print(e) # TODO: Figure out expected behaviour here!
                self.__is_listening = False

    def stop(self):
        """Stops listening for responses"""
        if not self.__is_listening:
            return

        self.__is_listening = False
        self.__sock.shutdown(socket.SHUT_RDWR)
        self.__sock.close()

    def run(self):
        """
        Spawns thread to serve and run the client
        NOTE: It is a little wierd that it blocks (It is written like this to allow for some console interaction in the future?)
        """

        self.__is_listening = True
        lthread = threading.Thread(target=self._listen, daemon=True)
        sthread = threading.Thread(target=self._serve, daemon=True)

        lthread.start()
        sthread.start()

        lthread.join()
        sthread.join()


client = UDPClient(("127.0.0.1", 12000))
client.run()
        
