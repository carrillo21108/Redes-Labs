#Universidad del Valle de Guatemala
#Redes seccion 20
#Laboratorio 2
#Carlos Lopez - Brian Carrillo

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

if __name__ == "__main__":
    encoded_message = input("Ingrese el mensaje codificado: ")
    valid, message = fletcher_checksum_verify(encoded_message)
    if valid:
        print("El mensaje es válido.")
        print(f"Mensaje decodificado: {message}")
    else:
        print("Se detectó un error en el mensaje.")
