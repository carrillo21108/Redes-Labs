from confluent_kafka import Producer
import json
import time
import random
from numpy import random as np_random
from enum import Enum

class WindDirection(Enum):
    N = 'N'
    NW = 'NO'
    W = 'O'
    SW = 'SO'
    S = 'S'
    SE = 'SE'
    E = 'E'
    NE = 'NE'

class WeatherStation:
    def __init__(self, temp_mean=55.0, temp_std=15.0, humidity_mean=55, humidity_std=15):
        self.temp_mean = temp_mean
        self.temp_std = temp_std
        self.humidity_mean = humidity_mean
        self.humidity_std = humidity_std

    def generate_temperature(self):
        temp = np_random.normal(self.temp_mean, self.temp_std)
        return round(max(0, min(110, temp)), 2)

    def generate_humidity(self):
        humidity = np_random.normal(self.humidity_mean, self.humidity_std)
        return int(max(0, min(100, humidity)))

    def generate_wind_direction(self):
        return random.choice(list(WindDirection)).value

    def generate_reading(self):
        reading = {
            "temperature": self.generate_temperature(),
            "humidity": self.generate_humidity(),
            "wind_direction": self.generate_wind_direction()
        }
        return reading
    
    def encode_weather_data(self, weather_data):
        """
        Encode weather data into 3 bytes (24 bits):
        - Temperature (14 bits): 0-16383 (we'll multiply temp by 100 to preserve 2 decimal places)
        - Humidity (7 bits): 0-100
        - Wind direction (3 bits): 0-7 (8 directions)
        """
        # Convert temperature to integer (multiply by 100 to preserve 2 decimal places)
        temp_int = int(weather_data["temperature"] * 100)
        
        # Create wind direction mapping
        wind_dict = {'N': 0, 'NE': 1, 'E': 2, 'SE': 3, 'S': 4, 'SO': 5, 'O': 6, 'NO': 7}
        wind_int = wind_dict[weather_data["wind_direction"]]
        
        # Combine all bits
        encoded = (temp_int << 10) | (weather_data["humidity"] << 3) | wind_int
        
        # Convert to 3 bytes
        return encoded.to_bytes(3, byteorder='big')

def delivery_report(err, msg):
    if err is not None:
        print(f'Message delivery failed: {err}')
    else:
        print(f'Message delivered to {msg.topic()} [{msg.partition()}]')

def main():
    # Kafka producer configuration
    conf = {
        'bootstrap.servers': '164.92.76.15:9092',
        'client.id': 'weather_station_producer'
    }

    # Create producer instance
    producer = Producer(**conf)

    # Create weather station instance
    weather_station = WeatherStation()

    # Topic to send data to
    topic = '21108'
    partition = 0   # Specify partition to send to

    try:
        while True:
            # Generate weather data
            weather_data = weather_station.generate_reading()
            encoded_data = weather_station.encode_weather_data(weather_data)
            
            # Send to Kafka
            producer.produce(
                topic=topic,
                partition=partition,
                value=encoded_data,
                callback=delivery_report
            )
            
            # Serve delivery callbacks
            producer.poll(0)
            
            print(f"Generated and sent: {weather_data}")
            
            # Wait for 15-30 seconds before next reading
            wait_time = random.uniform(15, 30)
            time.sleep(wait_time)

    except KeyboardInterrupt:
        print("\nInterrupted by user. Cleaning up...")
    finally:
        # Make sure all messages are sent before closing
        print("Flushing remaining messages...")
        producer.flush()
        print("Producer closed.")

if __name__ == '__main__':
    main()