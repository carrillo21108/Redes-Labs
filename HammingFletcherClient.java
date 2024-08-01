//Universidad del Valle de Guatemala
//Redes seccion 20
//Laboratorio 2.2
//Carlos Lopez - Brian Carrillo

import java.io.*;
import java.net.Socket;
import java.util.Random;
import java.util.Scanner;

public class HammingFletcherClient {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println("Ingrese un mensaje:");
        String message = scanner.nextLine();
        
        System.out.println("Seleccione el método de codificación (1 para Hamming, 2 para Fletcher):");
        int choice = scanner.nextInt();
        scanner.nextLine();

        System.out.println("Ingrese la tasa de error (por ejemplo, 0.01 para un error cada 100 bits):");
        double errorRate = scanner.nextDouble();
        scanner.nextLine();

        String encodedMessage = "";
        String binaryMessage = textToBinary(message);
        String serverHost = "localhost";
        int serverPort = 0;

        if (choice == 1) {
            encodedMessage = encodeHamming(binaryMessage);
            serverPort = 12346;
            System.out.println("Mensaje codificado usando Hamming: " + encodedMessage);
        } else if (choice == 2) {
            encodedMessage = binaryMessage + fletcherChecksum(binaryMessage);
            serverPort = 12347;
            System.out.println("Mensaje codificado usando Fletcher: " + encodedMessage);
        } else {
            System.out.println("Opción inválida.");
            return;
        }

        String noisyMessage = applyNoise(encodedMessage, errorRate);

        try (Socket socket = new Socket(serverHost, serverPort);
             PrintWriter out = new PrintWriter(socket.getOutputStream(), true);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()))) {
             
            out.println(noisyMessage);
            
            String decodedMessage = in.readLine();
            System.out.println("Mensaje: " + decodedMessage);
            
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public static String textToBinary(String text) {
        StringBuilder binary = new StringBuilder();
        for (char character : text.toCharArray()) {
            binary.append(
                String.format("%8s", Integer.toBinaryString(character))
                      .replaceAll(" ", "0")
            );
        }
        return binary.toString();
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
                hammingCode[hammingCode.length - i] = 0;
                k++;
            } else {
                hammingCode[hammingCode.length - i] = message.charAt(j) - '0';
                j++;
            }
        }

        for (int i = 0; i < r; i++) {
            int parityPos = (int) Math.pow(2, i);
            int parity = 0;
            for (int j2 = 1; j2 <= hammingCode.length; j2++) {
                if (((j2 >> i) & 1) == 1) {
                    parity ^= hammingCode[hammingCode.length - j2];
                }
            }
            hammingCode[hammingCode.length - parityPos] = parity;
        }

        StringBuilder encodedMessage = new StringBuilder();
        for (int bit : hammingCode) {
            encodedMessage.append(bit);
        }
        return encodedMessage.toString();
    }

    public static String fletcherChecksum(String message) {
        int sum1 = 0, sum2 = 0;
        for (int i = 0; i < message.length(); i++) {
            int val = message.charAt(i) - '0';
            sum1 = (sum1 + val) % 255;
            sum2 = (sum2 + sum1) % 255;
        }
        return String.format("%08d", Integer.parseInt(Integer.toBinaryString(sum1))) + 
               String.format("%08d", Integer.parseInt(Integer.toBinaryString(sum2)));
    }

    public static String applyNoise(String message, double errorRate) {
        StringBuilder noisyMessage = new StringBuilder(message);
        Random random = new Random();
        for (int i = 0; i < noisyMessage.length(); i++) {
            if (random.nextDouble() < errorRate) {
                noisyMessage.setCharAt(i, noisyMessage.charAt(i) == '0' ? '1' : '0');
            }
        }
        return noisyMessage.toString();
    }
}
