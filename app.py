#!/usr/bin/env python3
import os
import re
import uuid
import threading
import time
from flask import Flask, render_template, request, jsonify, send_from_directory, url_for
from werkzeug.utils import secure_filename
from video_utils import VideoProcessor
import logging

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('video_converter.log')
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['RENDER_FOLDER'] = 'Render'
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # 1GB макс. размер файла
app.config['CLEANUP_TEMP_FILES'] = True  # Очищать временные файлы после обработки

# Создаем необходимые директории, если они не существуют
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['RENDER_FOLDER'], exist_ok=True)

# Словарь для отслеживания статуса конвертации
conversion_status = {}

# Инициализируем процессор видео
video_processor = VideoProcessor(
    render_dir=app.config['RENDER_FOLDER'],
    temp_dir=app.config['UPLOAD_FOLDER']
)

def allowed_file(filename):
    """Проверяет, допустимое ли расширение файла"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in [
        'mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm', '3gp', 'ts', 'mpg', 'mpeg', 'm4v', 'mts', 'm2ts'
    ]

def sanitize_filename(filename):
    """Очищает имя файла от небезопасных символов"""
    # Удаляем компоненты пути и оставляем только имя файла
    filename = os.path.basename(filename)
    # Заменяем проблемные символы
    filename = re.sub(r'[^\w\.-]', '_', filename)
    return filename

def process_video_async(input_path, original_filename, job_id):
    """
    Асинхронно обрабатывает видео в отдельном потоке.

    Args:
        input_path: Путь к исходному видео
        original_filename: Исходное имя файла
        job_id: Идентификатор задачи
    """
    try:
        # Обрабатываем видео
        result = video_processor.process_video(input_path, original_filename)

        # Обновляем статус
        conversion_status[job_id].update(result)

        # Очищаем временный файл, если требуется
        if app.config['CLEANUP_TEMP_FILES']:
            video_processor.cleanup_temp_file(input_path)

    except Exception as e:
        logger.error(f"Ошибка при обработке видео: {str(e)}")
        conversion_status[job_id]['status'] = 'error'
        conversion_status[job_id]['error'] = str(e)

@app.route('/')
def index():
    """Отображает главную страницу"""
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """Обрабатывает загрузку файла"""
    if 'file' not in request.files:
        return jsonify({'error': 'Отсутствует файл в запросе'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Недопустимый тип файла'}), 400

    # Генерируем идентификатор задачи
    job_id = str(uuid.uuid4())

    try:
        # Сохраняем загруженный файл
        filename = secure_filename(file.filename)
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{job_id}_{filename}")
        file.save(input_path)

        # Инициализируем статус для этой задачи
        conversion_status[job_id] = {
            'status': 'uploaded',
            'input_filename': filename,
            'upload_time': time.time(),
            'file_size': os.path.getsize(input_path)
        }

        # Запускаем обработку в отдельном потоке
        thread = threading.Thread(
            target=process_video_async,
            args=(input_path, filename, job_id)
        )
        thread.daemon = True
        thread.start()

        return jsonify({
            'job_id': job_id,
            'status': 'uploaded'
        })

    except Exception as e:
        logger.error(f"Ошибка загрузки: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/status/<job_id>', methods=['GET'])
def check_status(job_id):
    """Проверяет статус обработки видео"""
    if job_id not in conversion_status:
        return jsonify({'error': 'Задача не найдена'}), 404

    status_data = conversion_status[job_id].copy()

    # Удаляем информацию о видео из ответа (она слишком большая)
    if 'video_info' in status_data:
        # Оставляем только базовую информацию
        video_info = status_data['video_info']
        status_data['video_info'] = {
            'duration': video_info.get('duration', 0),
            'is_vertical': video_info.get('is_vertical', False),
            'width': video_info.get('width', 0),
            'height': video_info.get('height', 0),
            'has_audio': video_info.get('has_audio', False)
        }

    if status_data['status'] == 'completed':
        # Добавляем URL для скачивания в ответ
        status_data['download_url'] = url_for(
            'download_file',
            filename=status_data['output_filename']
        )

        # Добавляем информацию о времени обработки
        if 'upload_time' in status_data:
            status_data['processing_time'] = time.time() - status_data['upload_time']

    return jsonify(status_data)

@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    """Отправляет обработанный файл для скачивания"""
    return send_from_directory(app.config['RENDER_FOLDER'], filename, as_attachment=True)

@app.route('/api/video/recent', methods=['GET'])
def get_recent_conversions():
    """Возвращает список последних конвертаций"""
    # Получаем последние 10 конвертаций
    recent = []
    for job_id, status in conversion_status.items():
        if status['status'] == 'completed':
            recent.append({
                'job_id': job_id,
                'filename': status['input_filename'],
                'output_filename': status['output_filename'],
                'timestamp': status.get('upload_time', 0)
            })

    # Сортируем по времени (последние сверху)
    recent.sort(key=lambda x: x['timestamp'], reverse=True)

    # Возвращаем только 10 последних
    return jsonify(recent[:10])

@app.route('/stats', methods=['GET'])
def get_stats():
    """Возвращает статистику конвертаций"""
    stats = {
        'total_jobs': len(conversion_status),
        'completed_jobs': sum(1 for status in conversion_status.values() if status['status'] == 'completed'),
        'error_jobs': sum(1 for status in conversion_status.values() if status['status'] == 'error'),
        'pending_jobs': sum(1 for status in conversion_status.values() if status['status'] in ['uploaded', 'processing']),
        'total_size_mb': sum(status.get('file_size', 0) for status in conversion_status.values()) / (1024 * 1024)
    }

    # Рассчитываем среднее время обработки
    processing_times = [
        status.get('processing_time', 0)
        for status in conversion_status.values()
        if status['status'] == 'completed' and 'processing_time' in status
    ]

    if processing_times:
        stats['avg_processing_time'] = sum(processing_times) / len(processing_times)
    else:
        stats['avg_processing_time'] = 0

    return jsonify(stats)

# Очистка старых записей (в реальном приложении стоит использовать Celery или другой планировщик)
def cleanup_old_records():
    """Удаляет старые записи о конвертациях"""
    current_time = time.time()
    for job_id in list(conversion_status.keys()):
        status = conversion_status[job_id]
        # Удаляем записи старше 24 часов
        if 'upload_time' in status and current_time - status['upload_time'] > 24 * 60 * 60:
            del conversion_status[job_id]

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)