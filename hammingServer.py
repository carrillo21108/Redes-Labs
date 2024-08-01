#Universidad del Valle de Guatemala
#Redes seccion 20
#Laboratorio 2.2
#Carlos Lopez - Brian Carrillo

import socket

def decode_hamming(hamming_code):
    n = len(hamming_code)
    r = 0
    while (2**r < n + 1):
        r += 1
    error_pos = 0
    for i in range(r):
        parity = 0
        for j in range(1, n + 1):
            if ((j >> i) & 1) == 1:
                parity ^= int(hamming_code[n - j])
        if parity != 0:
            error_pos += 2**i
    if error_pos != 0:
        print(f"Se detectaron y corrigieron errores en la posición {error_pos}.")
        hamming_code[n - error_pos] = '1' if hamming_code[n - error_pos] == '0' else '0'
    original_message = [hamming_code[n - i] for i in range(1, n + 1) if (i & (i - 1)) != 0]
    return ''.join(original_message)

def binary_to_text(binary_message):
    binary_int = int(binary_message, 2)
    byte_number = (binary_int.bit_length() + 7) // 8
    binary_array = binary_int.to_bytes(byte_number, "big")
    ascii_text = binary_array.decode(errors='ignore')
    return ascii_text

def main():
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind(('localhost', 12346))
    server_socket.listen(1)
    print("Servidor de Hamming escuchando en el puerto 12346...")

    while True:
        client_socket, addr = server_socket.accept()
        print(f"Conexión aceptada de {addr}")

        data = client_socket.recv(1024).decode().strip()
        if not data:
            break

        decoded_binary_message = decode_hamming(list(data))
        decoded_text_message = binary_to_text(decoded_binary_message)

        print(f"Mensaje decodificado: {decoded_text_message}")
        client_socket.send(decoded_text_message.encode())
        client_socket.close()

if __name__ == "__main__":
    main()
