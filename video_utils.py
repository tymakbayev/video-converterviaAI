#!/usr/bin/env python3
import os
import json
import subprocess
import re
import shlex
from typing import Dict, Tuple, Optional, Any, List
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class VideoProcessor:
    """
    Класс для обработки видео с использованием FFmpeg.
    Предоставляет методы для извлечения информации о видео,
    конвертации в MP4 и обработки вертикальных видео.
    """
    
    def __init__(self, render_dir: str = 'Render', temp_dir: str = 'uploads'):
        """
        Инициализирует процессор видео.
        
        Args:
            render_dir: Директория для сохранения готовых файлов
            temp_dir: Директория для временных файлов
        """
        self.render_dir = render_dir
        self.temp_dir = temp_dir
        
        # Создаем директории, если они не существуют
        os.makedirs(render_dir, exist_ok=True)
        os.makedirs(temp_dir, exist_ok=True)
    
    def get_video_info(self, input_path: str) -> Dict[str, Any]:
        """
        Извлекает подробную информацию о видеофайле.
        
        Args:
            input_path: Путь к видеофайлу
            
        Returns:
            Словарь с информацией о видео (разрешение, битрейт, fps и т.д.)
        """
        try:
            # Используем ffprobe для получения данных в формате JSON
            cmd = [
                'ffprobe',
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                input_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            
            # Извлекаем параметры видеопотока
            video_stream = None
            audio_stream = None
            
            for stream in data.get('streams', []):
                if stream.get('codec_type') == 'video' and not video_stream:
                    video_stream = stream
                elif stream.get('codec_type') == 'audio' and not audio_stream:
                    audio_stream = stream
            
            if not video_stream:
                raise ValueError("Видеопоток не найден в файле")
            
            # Извлекаем и обрабатываем информацию о видео
            width = int(video_stream.get('width', 0))
            height = int(video_stream.get('height', 0))
            
            # Получаем FPS
            fps = 0
            fps_str = video_stream.get('r_frame_rate', '0/1')
            if '/' in fps_str:
                num, den = map(int, fps_str.split('/'))
                if den != 0:
                    fps = round(num / den, 2)
            
            # Получаем общую информацию о формате
            format_info = data.get('format', {})
            
            # Длительность в секундах
            duration = float(format_info.get('duration', 0))
            
            # Общий битрейт
            bitrate = int(format_info.get('bit_rate', 0))
            
            # Битрейт видео (если доступен)
            video_bitrate = int(video_stream.get('bit_rate', 0))
            if video_bitrate == 0 and audio_stream:
                # Если битрейт видео не указан, попробуем рассчитать
                audio_bitrate = int(audio_stream.get('bit_rate', 0))
                if audio_bitrate > 0 and bitrate > audio_bitrate:
                    video_bitrate = bitrate - audio_bitrate
                else:
                    # Если ничего не помогло, используем общий битрейт
                    video_bitrate = bitrate
            
            # Аудио битрейт
            audio_bitrate = 0
            if audio_stream:
                audio_bitrate = int(audio_stream.get('bit_rate', 0))
                # Если битрейт аудио не указан, используем стандартный
                if audio_bitrate == 0:
                    audio_bitrate = 128000  # 128 кбит/с
            
            # Количество аудиоканалов
            audio_channels = 0
            if audio_stream:
                audio_channels = int(audio_stream.get('channels', 0))
            
            # Кодеки
            video_codec = video_stream.get('codec_name', '')
            audio_codec = ''
            if audio_stream:
                audio_codec = audio_stream.get('codec_name', '')
            
            # Собираем всю информацию
            info = {
                'width': width,
                'height': height,
                'is_vertical': height > width,
                'fps': fps,
                'duration': duration,
                'bitrate': bitrate,
                'video_bitrate': video_bitrate,
                'audio_bitrate': audio_bitrate,
                'audio_channels': audio_channels,
                'video_codec': video_codec,
                'audio_codec': audio_codec,
                'has_audio': audio_stream is not None
            }
            
            return info
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Ошибка при получении информации о видео: {e}")
            raise ValueError(f"Не удалось получить информацию о видео: {e}")
        except json.JSONDecodeError as e:
            logger.error(f"Ошибка при обработке JSON: {e}")
            raise ValueError(f"Ошибка при обработке JSON: {e}")
        except Exception as e:
            logger.error(f"Непредвиденная ошибка: {e}")
            raise ValueError(f"Ошибка при обработке видео: {e}")
    
    def generate_output_filename(self, input_filename: str) -> Tuple[str, str]:
        """
        Генерирует уникальное имя для выходного файла.
        
        Args:
            input_filename: Исходное имя файла
            
        Returns:
            Кортеж (относительное_имя, полный_путь)
        """
        # Получаем базовое имя без расширения
        base_name = os.path.splitext(os.path.basename(input_filename))[0]
        
        # Формируем имя для выходного файла
        output_name = f"{base_name}_convert.mp4"
        output_path = os.path.join(self.render_dir, output_name)
        
        # Проверяем, существует ли файл с таким именем
        counter = 1
        while os.path.exists(output_path):
            output_name = f"{base_name}_convert_{counter}.mp4"
            output_path = os.path.join(self.render_dir, output_name)
            counter += 1
        
        return output_name, output_path
    
    def convert_video(self, input_path: str, output_path: str, video_info: Dict[str, Any]) -> bool:
        """
        Конвертирует видео в формат MP4 с заданными параметрами.
        
        Args:
            input_path: Путь к исходному видео
            output_path: Путь для сохранения результата
            video_info: Информация о видео
            
        Returns:
            True если конвертация успешна, иначе False
        """
        try:
            # Формируем базовые параметры FFmpeg
            cmd = ['ffmpeg', '-y', '-i', input_path]
            
            # Настраиваем параметры видеопотока
            cmd.extend(['-c:v', 'libx264'])
            
            # Устанавливаем частоту кадров 25 FPS
            cmd.extend(['-r', '25'])
            
            # Если видео вертикальное, применяем специальную обработку
            if video_info['is_vertical']:
                # Обрабатываем вертикальное видео - добавляем черные полосы по бокам
                # Определяем размер выходного видео (16:9)
                target_height = min(video_info['height'], 1080)
                target_width = int(target_height * 16 / 9)
                
                # Формируем фильтр для вписывания вертикального видео в горизонтальный кадр
                vf = f"scale=w={target_width}:h={target_height}:force_original_aspect_ratio=decrease,"
                vf += f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black"
                
                # Используем CRF (Constant Rate Factor) для контроля качества
                cmd.extend(['-vf', vf, '-crf', '23'])
            else:
                # Для горизонтального видео сохраняем оригинальный битрейт
                video_bitrate = max(video_info['video_bitrate'], 1000000)  # Минимум 1 Мбит/с
                
                # Конвертируем битрейт в килобиты
                video_bitrate_kb = int(video_bitrate / 1000)
                cmd.extend(['-b:v', f"{video_bitrate_kb}k"])
            
            # Настраиваем аудиопоток
            if video_info['has_audio']:
                if video_info['audio_codec'] == 'aac':
                    # Если аудио уже в AAC, просто копируем
                    cmd.extend(['-c:a', 'copy'])
                else:
                    # Иначе конвертируем в AAC
                    cmd.extend(['-c:a', 'aac'])
                    
                    # Устанавливаем битрейт аудио
                    if video_info['audio_bitrate'] > 0:
                        # Используем оригинальный битрейт, округленный до ближайших 16 кбит/с
                        audio_bitrate_kb = int(video_info['audio_bitrate'] / 1000)
                        audio_bitrate_kb = round(audio_bitrate_kb / 16) * 16
                        cmd.extend(['-b:a', f"{audio_bitrate_kb}k"])
                    else:
                        # Используем стандартный битрейт, если оригинальный не определен
                        cmd.extend(['-b:a', '128k'])
            else:
                # Если аудио нет, удаляем все аудиопотоки
                cmd.extend(['-an'])
            
            # Добавляем путь выходного файла
            cmd.append(output_path)
            
            # Логируем команду
            logger.info(f"Выполняем команду: {' '.join(map(shlex.quote, cmd))}")
            
            # Запускаем процесс конвертации
            process = subprocess.run(cmd, capture_output=True, text=True)
            
            # Проверяем результат
            if process.returncode != 0:
                logger.error(f"Ошибка FFmpeg: {process.stderr}")
                return False
            
            logger.info(f"Конвертация завершена успешно: {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Ошибка при конвертации видео: {e}")
            return False
    
    def process_video(self, input_path: str, original_filename: str) -> Dict[str, Any]:
        """
        Обрабатывает видео - извлекает информацию, конвертирует и возвращает результат.
        
        Args:
            input_path: Путь к исходному видео
            original_filename: Исходное имя файла
            
        Returns:
            Словарь с результатами обработки
        """
        try:
            # Получаем информацию о видео
            video_info = self.get_video_info(input_path)
            
            # Генерируем имя для выходного файла
            output_filename, output_path = self.generate_output_filename(original_filename)
            
            # Конвертируем видео
            success = self.convert_video(input_path, output_path, video_info)
            
            if not success:
                return {
                    'status': 'error',
                    'error': 'Ошибка при конвертации видео'
                }
            
            # Возвращаем результат
            return {
                'status': 'completed',
                'output_filename': output_filename,
                'video_info': video_info
            }
            
        except Exception as e:
            logger.error(f"Ошибка при обработке видео: {e}")
            return {
                'status': 'error',
                'error': str(e)
            }
    
    def cleanup_temp_file(self, filepath: str) -> bool:
        """
        Удаляет временный файл.
        
        Args:
            filepath: Путь к файлу
            
        Returns:
            True если удаление успешно, иначе False
        """
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                logger.info(f"Удален временный файл: {filepath}")
                return True
            return False
        except Exception as e:
            logger.error(f"Ошибка при удалении временного файла {filepath}: {e}")
            return False