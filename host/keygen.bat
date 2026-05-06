@echo off
cd keys
start "" "%ProgramFiles%\Git\git-bash.exe" -c "export MSYS_NO_PATHCONV=1 && openssl req -x509 -newkey rsa:4096 -sha512 -days 365 -noenc -keyout key.pem -out cert.pem -subj ""/C=US/ST=Massachusetts/L=Boston/CN=YourNameHere"""