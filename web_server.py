#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys
from urllib.parse import unquote

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory='/home/user/webapp/dist', **kwargs)
    
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def log_message(self, format, *args):
        sys.stdout.write(f"{self.log_date_time_string()} - {format%args}\n")
        sys.stdout.flush()

if __name__ == "__main__":
    PORT = 8080
    
    # Change to dist directory
    os.chdir('/home/user/webapp/dist')
    
    with socketserver.TCPServer(("0.0.0.0", PORT), CustomHandler) as httpd:
        print(f"서버가 포트 {PORT}에서 실행 중입니다...")
        print(f"웹사이트: http://0.0.0.0:{PORT}")
        sys.stdout.flush()
        httpd.serve_forever()