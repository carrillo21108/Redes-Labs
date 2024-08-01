#Universidad del Valle de Guatemala
#Redes seccion 20
#Laboratorio 2.2
#Carlos Lopez - Brian Carrillo

import socket

def fletcher_checksum(message):
    sum1 = 0
    sum2 = 0
    for char in message:
        val = int(char)  # Convertir de char a int
        sum1 = (sum1 + val) % 255
        sum2 = (sum2 + sum1) % 255
    return f"{sum1:08b}{sum2:08b}"

def fletcher_checksum_verify(encoded_message):
    length = len(encoded_message)
    if length < 16:
        return False, ""  # Mensaje demasiado corto para contener un checksum válido
    message = encoded_message[:-16]
    received_checksum = encoded_message[-16:]
    calculated_checksum = fletcher_checksum(message)
    return received_checksum == calculated_checksum, message

def binary_to_text(binary_message):
    binary_int = int(binary_message, 2)
    byte_number = (binary_int.bit_length() + 7) // 8
    binary_array = binary_int.to_bytes(byte_number, "big")
    ascii_text = binary_array.decode(errors='ignore')
    return ascii_text

def main():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind(('localhost', 12347))
    server_socket.listen(1)
    print("Servidor de Fletcher escuchando en el puerto 12347...")

    while True:
        client_socket, addr = server_socket.accept()
        print(f"Conexión aceptada de {addr}")

        data = client_socket.recv(1024).decode().strip()
        if not data:
            break

        valid, message = fletcher_checksum_verify(data)
        if valid:
            print("El mensaje es válido.")
            decoded_text_message = binary_to_text(message)
        else:
            decoded_text_message = "Se detectó un error en el mensaje."

        print(f"Mensaje decodificado: {decoded_text_message}")
        client_socket.send(decoded_text_message.encode())
        client_socket.close()

if __name__ == "__main__":
    main()
