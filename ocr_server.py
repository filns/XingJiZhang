"""
OCR Local HTTP Service (EasyOCR backend)
Usage: python ocr_server.py [--port 8868]
First run will download the detection/recognition models (~100 MB).
"""
import sys, os, json, base64, io, argparse, signal
from http.server import HTTPServer, BaseHTTPRequestHandler

HOST = '127.0.0.1'
PORT = 8868


class OCRHandler(BaseHTTPRequestHandler):
    reader = None

    def log_message(self, *args):
        pass

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ('/', '/health'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'engine': 'easyocr'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != '/ocr':
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get('Content-Length', 0))
        if length == 0 or length > 10 * 1024 * 1024:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Empty or too large body'}, ensure_ascii=False).encode())
            return

        body = json.loads(self.rfile.read(length))
        img_b64 = body.get('image', '')
        if not img_b64:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'No image field'}, ensure_ascii=False).encode())
            return

        if ';base64,' in img_b64:
            img_b64 = img_b64.split(';base64,')[1]

        try:
            img_bytes = base64.b64decode(img_b64)
        except Exception:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Invalid base64'}, ensure_ascii=False).encode())
            return

        try:
            from PIL import Image
            import numpy as np
            img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
            results = self.__class__.reader.readtext(np.array(img))
        except Exception as e:
            self.send_response(500)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'OCR engine error: {e}'}, ensure_ascii=False).encode())
            return

        # EasyOCR returns: [[bbox, text, confidence], ...]
        words_result = []
        raw_lines = []
        if results:
            for item in results:
                text = item[1]
                conf = float(item[2])
                words_result.append({'words': text, 'probability': {'average': conf}})
                raw_lines.append(text)

        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps({
            'rawText': '\n'.join(raw_lines),
            'words_result': words_result,
            'words_result_num': len(words_result)
        }, ensure_ascii=False).encode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8868)
    parser.add_argument('--gpu', action='store_true', default=False)
    args = parser.parse_args()
    port = args.port

    print(f'[OCR Server] Loading EasyOCR (first run downloads models)...')
    try:
        import easyocr
        OCRHandler.reader = easyocr.Reader(['ch_sim', 'en'], gpu=args.gpu, verbose=False)
        print('[OCR Server] Engine ready.')
    except Exception as e:
        print(f'[OCR Server] Failed to init: {e}')
        print('  Install: pip install easyocr')
        sys.exit(1)

    server = HTTPServer((HOST, port), OCRHandler)
    print(f'[OCR Server] Listening on http://{HOST}:{port}')
    print(f'[OCR Server] Press Ctrl+C to stop.')

    def shutdown(sig, frame):
        print('\n[OCR Server] Shutting down...')
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == '__main__':
    main()
