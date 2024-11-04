import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from collections import deque
from datetime import datetime, timedelta
from confluent_kafka import Consumer, KafkaError, TopicPartition
import json
import threading
import time

class WeatherDataVisualizer:
    def __init__(self, window_size=30):
        self.window_size = window_size
        self.start_time = time.time()  # Record the start time
        self.elapsed_times = deque(maxlen=window_size)  # Store elapsed times in seconds
        self.temperatures = deque(maxlen=window_size)
        self.humidities = deque(maxlen=window_size)
        self.wind_directions = deque(maxlen=window_size)
        
        plt.ion()
        self.fig, (self.ax1, self.ax2) = plt.subplots(2, 1, figsize=(12, 8))
        self.fig.suptitle('Weather Station Real-time Data')
        
        # Initialize lines for real-time plotting
        self.temp_line, = self.ax1.plot([], [], 'r-', label='Temperature (°F)')
        self.humidity_line, = self.ax1.plot([], [], 'b-', label='Humidity (%)')
        
        # Setup axes
        self.ax1.set_xlabel('Time Elapsed (seconds)')
        self.ax1.set_ylabel('Value')
        self.ax1.legend()
        self.ax1.grid(True)
        
        # Wind direction subplot
        self.ax2.set_xlabel('Time Elapsed (seconds)')
        self.ax2.set_ylabel('Wind Direction')
        self.ax2.grid(True)
        
        plt.tight_layout()

    def update_plot(self):
        # Update temperature and humidity plot
        self.temp_line.set_data(list(self.elapsed_times), list(self.temperatures))
        self.humidity_line.set_data(list(self.elapsed_times), list(self.humidities))
        
        # Update wind direction plot
        self.ax2.clear()
        self.ax2.scatter(list(self.elapsed_times), list(self.wind_directions))
        self.ax2.set_xlabel('Time Elapsed (seconds)')
        self.ax2.set_ylabel('Wind Direction')
        self.ax2.grid(True)
        
        # Adjust limits
        if len(self.elapsed_times) > 0:
            # Add some padding to the x-axis
            x_min = min(self.elapsed_times)
            x_max = max(self.elapsed_times)
            x_padding = (x_max - x_min) * 0.1 if x_max != x_min else 5
            
            self.ax1.set_xlim(x_min - x_padding, x_max + x_padding)
            self.ax2.set_xlim(x_min - x_padding, x_max + x_padding)
            
            if self.temperatures and self.humidities:
                min_val = min(min(self.temperatures), min(self.humidities))
                max_val = max(max(self.temperatures), max(self.humidities))
                y_padding = (max_val - min_val) * 0.1
                self.ax1.set_ylim(min_val - y_padding, max_val + y_padding)
        
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()

    def add_data_point(self, data):
        elapsed_time = time.time() - self.start_time  # Calculate elapsed time
        self.elapsed_times.append(elapsed_time)
        self.temperatures.append(data['temperature'])
        self.humidities.append(data['humidity'])
        self.wind_directions.append(data['wind_direction'])
        self.update_plot()

    def decode_weather_data(self, data_bytes):
        """
        Decode 3 bytes back into weather data
        """
        # Convert bytes to integer
        encoded = int.from_bytes(data_bytes, byteorder='big')
        
        # Extract wind direction (last 3 bits)
        wind_int = encoded & 0b111
        
        # Extract humidity (next 7 bits)
        humidity = (encoded >> 3) & 0b1111111
        
        # Extract temperature (remaining 14 bits)
        temp_int = (encoded >> 10) & 0b11111111111111
        
        # Convert wind direction back to cardinal direction
        wind_dict = {0: 'N', 1: 'NE', 2: 'E', 3: 'SE', 4: 'S', 5: 'SO', 6: 'O', 7: 'NO'}
        wind_direction = wind_dict[wind_int]
        
        # Convert temperature back to float
        temperature = temp_int / 100.0
        
        return {
            "temperature": temperature,
            "humidity": humidity,
            "wind_direction": wind_direction
        }

def consume_weather_data():
    # Configure the consumer
    config = {
        'bootstrap.servers': '164.92.76.15:9092',
        'group.id': 'weather_visualization_group',
        'auto.offset.reset': 'latest'
    }

    # Create Consumer instance
    consumer = Consumer(config)
    topic = '21108'
    partition = 0

    # Create TopicPartition object
    topic_partition = TopicPartition(topic, partition)

    # Assign specific partition
    consumer.assign([topic_partition])

    # Create visualizer
    visualizer = WeatherDataVisualizer()

    try:
        while True:
            msg = consumer.poll(1.0)

            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    print('Reached end of partition')
                else:
                    print(f'Error: {msg.error()}')
                continue

            try:
                # Parse the message value
                weather_data = visualizer.decode_weather_data(msg.value())
                print(f"Received weather data: {weather_data}")
                
                # Update the visualization
                visualizer.add_data_point(weather_data)
                
            except json.JSONDecodeError as e:
                print(f"Error decoding JSON: {e}")
                continue

    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        # Close down consumer to commit final offsets.
        consumer.close()
        plt.ioff()
        plt.close('all')

if __name__ == "__main__":
    consume_weather_data()