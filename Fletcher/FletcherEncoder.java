//Universidad del Valle de Guatemala
//Redes seccion 20
//Laboratorio 2
//Carlos Lopez - Brian Carrillo

import java.util.Scanner;

public class FletcherEncoder {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println("Ingrese un mensaje:");
        String message = scanner.nextLine();
        String checksum = fletcherChecksum(message);
        System.out.println("Mensaje codificado: " + message + checksum);
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
}