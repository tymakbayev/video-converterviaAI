document.addEventListener('DOMContentLoaded', function() {
    // Элементы интерфейса
    const uploadForm = document.getElementById('upload-form');
    const fileInput = document.getElementById('file-input');
    const fileName = document.getElementById('file-name');
    const uploadButton = document.getElementById('upload-button');

    const uploadContainer = document.getElementById('upload-container');
    const progressContainer = document.getElementById('progress-container');
    const processingContainer = document.getElementById('processing-container');
    const resultContainer = document.getElementById('result-container');
    const errorContainer = document.getElementById('error-container');

    const progressBar = document.getElementById('progress-bar');
    const progressPercentage = document.getElementById('progress-percentage');
    const statusText = document.getElementById('status-text');
    const resultMessage = document.getElementById('result-message');

    const downloadButton = document.getElementById('download-button');
    const convertAnotherButton = document.getElementById('convert-another-button');
    const tryAgainButton = document.getElementById('try-again-button');
    const errorMessage = document.getElementById('error-message');

    // Аналитика и статистика
    let conversionStartTime = 0;
    let conversionStats = {
        totalConversions: 0,
        successfulConversions: 0,
        failedConversions: 0,
        averageProcessingTime: 0
    };

    // Создаем экземпляр VideoProcessor
    const processor = new VideoProcessor({
        uploadEndpoint: '/upload',
        statusEndpoint: '/status/',
        downloadEndpoint: '/download/',
        maxFileSize: 1024 * 1024 * 1024, // 1GB
        pollInterval: 2000 // 2 секунды
    });

    // Устанавливаем обработчики событий для VideoProcessor
    processor.on({
        // Начало загрузки
        onUploadStart: () => {
            // Показываем индикатор прогресса
            uploadContainer.classList.add('hidden');
            progressContainer.classList.remove('hidden');

            // Устанавливаем сообщение о загрузке
            statusText.textContent = 'Загрузка файла...';
        },

        // Прогресс загрузки
        onUploadProgress: (percentage) => {
            // Обновляем индикатор прогресса
            progressBar.style.width = percentage + '%';
            progressPercentage.textContent = percentage + '%';
        },

        // Завершение загрузки
        onUploadComplete: () => {
            // Обновляем сообщение о завершении загрузки
            statusText.textContent = 'Загрузка завершена. Подготовка к конвертации...';
        },

        // Начало обработки
        onProcessingStart: () => {
            // Показываем индикатор обработки
            progressContainer.classList.add('hidden');
            processingContainer.classList.remove('hidden');

            // Запоминаем время начала конвертации для статистики
            conversionStartTime = Date.now();
        },

        // Завершение обработки
        onProcessingComplete: (downloadUrl) => {
            // Показываем результат
            processingContainer.classList.add('hidden');
            resultContainer.classList.remove('hidden');

            // Устанавливаем сообщение об успехе
            resultMessage.textContent = 'Конвертация успешно завершена!';

            // Обновляем статистику
            const processingTime = (Date.now() - conversionStartTime) / 1000; // в секундах
            conversionStats.totalConversions++;
            conversionStats.successfulConversions++;

            // Обновляем среднее время обработки
            if (conversionStats.averageProcessingTime === 0) {
                conversionStats.averageProcessingTime = processingTime;
            } else {
                conversionStats.averageProcessingTime =
                    (conversionStats.averageProcessingTime * (conversionStats.successfulConversions - 1) + processingTime) /
                    conversionStats.successfulConversions;
            }

            // Добавляем информацию о времени конвертации
            const timeInfo = document.createElement('p');
            timeInfo.classList.add('processing-time');
            timeInfo.textContent = `Время конвертации: ${processingTime.toFixed(1)} секунд`;
            resultContainer.querySelector('.result-status').appendChild(timeInfo);

            // Настройка кнопки скачивания
            downloadButton.onclick = function() {
                processor.download();
            };
        },

        // Обработка ошибок
        onError: (message) => {
            // Показываем сообщение об ошибке
            uploadContainer.classList.add('hidden');
            progressContainer.classList.add('hidden');
            processingContainer.classList.add('hidden');
            resultContainer.classList.add('hidden');
            errorContainer.classList.remove('hidden');

            // Устанавливаем текст ошибки
            errorMessage.textContent = message;

            // Обновляем статистику, если ошибка произошла во время конвертации
            if (conversionStartTime > 0) {
                conversionStats.totalConversions++;
                conversionStats.failedConversions++;
                conversionStartTime = 0;
            }
        },

        // Сброс формы
        onReset: () => {
            // Скрываем результат, если он показан
            resultContainer.classList.add('hidden');
            errorContainer.classList.add('hidden');

            // Показываем форму загрузки
            uploadContainer.classList.remove('hidden');

            // Сбрасываем прогресс
            progressBar.style.width = '0%';
            progressPercentage.textContent = '0%';

            // Очищаем файловый ввод
            fileInput.value = '';
            fileName.textContent = 'Файл не выбран';

            // Удаляем дополнительную информацию о времени, если есть
            const timeInfo = resultContainer.querySelector('.processing-time');
            if (timeInfo) {
                timeInfo.remove();
            }

            // Сбрасываем время начала конвертации
            conversionStartTime = 0;
        }
    });

    // Обработчик изменения выбранного файла
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            // Устанавливаем файл и отображаем его имя
            const isValid = processor.setFile(this.files[0]);
            if (isValid) {
                fileName.textContent = this.files[0].name;
                uploadButton.disabled = false;
            } else {
                this.value = '';
                fileName.textContent = 'Файл не выбран';
                uploadButton.disabled = true;
            }
        } else {
            fileName.textContent = 'Файл не выбран';
            uploadButton.disabled = true;
        }
    });

    // Обработчик отправки формы
    uploadForm.addEventListener('submit', function(e) {
        e.preventDefault();

        if (fileInput.files.length === 0) {
            processor.events.onError('Пожалуйста, выберите файл для загрузки');
            return;
        }

        // Запускаем процесс обработки
        processor.start();
    });

    // Обработчик кнопки "Конвертировать еще"
    convertAnotherButton.addEventListener('click', function() {
        processor.reset();
    });

    // Обработчик кнопки "Попробовать снова"
    tryAgainButton.addEventListener('click', function() {
        processor.reset();
    });

    // Drag & drop функциональность
    const dropZone = document.querySelector('.container');

    // Предотвращаем стандартное поведение браузера при перетаскивании файлов
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Подсветка области при перетаскивании
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        dropZone.classList.add('highlight');
    }

    function unhighlight() {
        dropZone.classList.remove('highlight');
    }

    // Обработка события drop
    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            fileInput.files = files;
            const event = new Event('change');
            fileInput.dispatchEvent(event);
        }
    }

    // Добавляем кнопку для отображения статистики
    const statsButton = document.createElement('button');
    statsButton.textContent = 'Показать статистику';
    statsButton.classList.add('stats-button');
    statsButton.onclick = function() {
        alert(`Статистика конвертации:
- Всего конвертаций: ${conversionStats.totalConversions}
- Успешных конвертаций: ${conversionStats.successfulConversions}
- Неудачных конвертаций: ${conversionStats.failedConversions}
- Среднее время обработки: ${conversionStats.averageProcessingTime.toFixed(1)} секунд`);
    };

    // Добавляем кнопку в документ
    document.querySelector('footer').appendChild(statsButton);
});