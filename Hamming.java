//Universidad del Valle de Guatemala
//Redes seccion 20
//Laboratorio 2
//Carlos Lopez - Brian Carrillo

import java.util.Scanner;

public class Hamming {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println("Ingrese un mensaje:");
        String message = scanner.nextLine();
        String encodedMessage = encodeHamming(message);
        System.out.println("Mensaje codificado: " + encodedMessage);
    }

    public static String encodeHamming(String message) {
        int m = message.length();
        int r = 0;
        while (Math.pow(2, r) < (m + r + 1)) {
            r++;
        }   
        int[] hammingCode = new int[m + r];
        int j = 0, k = 0;
        for (int i = 1; i <= hammingCode.length; i++) {
            if (Math.pow(2, k) == i) {
                hammingCode[i - 1] = 0;
                k++;
            } else {
                hammingCode[i - 1] = message.charAt(j) - '0';
                j++;
            }
        }
        for (int i = 0; i < r; i++) {
            int parityPos = (int) Math.pow(2, i);
            int parity = 0;
            for (int j2 = 1; j2 <= hammingCode.length; j2++) {
                if (((j2 >> i) & 1) == 1) {
                    parity ^= hammingCode[j2 - 1];
                }
            }
            hammingCode[parityPos - 1] = parity;
        }
        StringBuilder encodedMessage = new StringBuilder();
        for (int bit : hammingCode) {
            encodedMessage.append(bit);
        }
        return encodedMessage.toString();
    }
}
