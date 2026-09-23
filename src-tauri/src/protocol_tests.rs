//! Real loopback sockets exercise the same IMAP and SMTP clients as the desktop app.
//! All identities, passwords and messages here are synthetic test fixtures.
use crate::{db, mail, model::*};
use lettre::Transport;
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    thread,
    time::Duration,
};
fn account(port: u16) -> Account {
    Account {
        id: "fixture".into(),
        name: "Test".into(),
        sender_name: "Local Test".into(),
        email: "me@example.test".into(),
        imap: Server {
            host: "127.0.0.1".into(),
            port,
            login: "fixture".into(),
            security: Security::None,
        },
        smtp: Server {
            host: "127.0.0.1".into(),
            port,
            login: "fixture".into(),
            security: Security::None,
        },
        same_credentials: true,
        is_default: true,
        enabled: true,
    }
}
#[test]
fn imap_sync_flags_delete_and_empty_folder() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let a = account(listener.local_addr().unwrap().port());
    let server = thread::spawn(move || {
        let mut commands = Vec::new();
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            socket.write_all(b"* OK fixture ready\r\n").unwrap();
            let mut empty = false;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap() == 0 {
                    break;
                }
                let (tag, cmd) = line.trim_end().split_once(' ').unwrap();
                commands.push(cmd.to_string());
                let raw="From: Sender <sender@example.test>\r\nTo: me@example.test\r\nSubject: Local fixture\r\nMessage-ID: <fixture@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello from IMAP";
                let response = if cmd.starts_with("LOGIN ") {
                    format!("{tag} OK logged in\r\n")
                } else if cmd.starts_with("LIST ") {
                    format!("* LIST () \"/\" \"INBOX\"\r\n* LIST (\\Trash) \"/\" \"Trash\"\r\n{tag} OK list\r\n")
                } else if cmd.starts_with("SELECT ") {
                    empty = cmd.contains("Trash");
                    format!("* FLAGS (\\Seen \\Flagged \\Deleted)\r\n* {} EXISTS\r\n* OK [UIDVALIDITY 42] valid\r\n{tag} OK selected\r\n",if empty{0}else{1})
                } else if cmd.starts_with("UID SEARCH") {
                    format!(
                        "* SEARCH{}\r\n{tag} OK search\r\n",
                        if empty { "" } else { " 7" }
                    )
                } else if cmd.contains("RFC822.SIZE") {
                    format!(
                        "* 1 FETCH (UID 7 FLAGS () RFC822.SIZE {})\r\n{tag} OK fetch\r\n",
                        raw.len()
                    )
                } else if cmd.contains("BODY.PEEK[]") {
                    format!(
                        "* 1 FETCH (UID 7 FLAGS () BODY[] {{{}}}\r\n{raw})\r\n{tag} OK fetched\r\n",
                        raw.len()
                    )
                } else if cmd.starts_with("UID FETCH") {
                    assert!(!empty, "must not fetch an empty folder");
                    format!("* 1 FETCH (UID 7 FLAGS ())\r\n{tag} OK flags\r\n")
                } else if cmd.starts_with("UID STORE") {
                    format!("{tag} OK stored\r\n")
                } else if cmd == "CAPABILITY" {
                    format!("* CAPABILITY IMAP4rev1 MOVE UIDPLUS\r\n{tag} OK capabilities\r\n")
                } else if cmd.starts_with("UID MOVE") {
                    format!("{tag} OK moved\r\n")
                } else if cmd == "LOGOUT" {
                    socket
                        .write_all(format!("* BYE\r\n{tag} OK bye\r\n").as_bytes())
                        .unwrap();
                    break;
                } else {
                    panic!("Unexpected IMAP command")
                };
                socket.write_all(response.as_bytes()).unwrap();
            }
        }
        commands
    });
    let path = std::env::temp_dir().join(format!("morfius-test-{}.db", uuid::Uuid::new_v4()));
    let mut c = db::open(&path).unwrap();
    db::save_account(&mut c, &a).unwrap();
    mail::run(&a, "fixture-password", mail::Job::Sync(&path)).unwrap();
    let id = "fixture:INBOX:42:7";
    let m = db::message(&c, id).unwrap();
    assert_eq!(m.text, "Hello from IMAP");
    assert!(!m.read);
    mail::run(&a, "fixture-password", mail::Job::Action(&path, id, "star")).unwrap();
    assert!(db::message(&c, id).unwrap().starred);
    mail::run(
        &a,
        "fixture-password",
        mail::Job::Action(&path, id, "delete"),
    )
    .unwrap();
    assert!(db::message(&c, id).is_err());
    let commands = server.join().unwrap();
    assert!(commands.iter().any(|c| c.starts_with("UID MOVE")));
    assert!(!commands.iter().any(|c| c == "EXPUNGE"));
    drop(c);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn smtp_transmits_mime_and_reply_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let a = account(listener.local_addr().unwrap().port());
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        socket
            .write_all(b"220 localhost ESMTP fixture\r\n")
            .unwrap();
        let mut captured = String::new();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap() == 0 {
                break;
            }
            if line.starts_with("EHLO") {
                socket
                    .write_all(b"250-localhost\r\n250 AUTH PLAIN\r\n")
                    .unwrap()
            } else if line.starts_with("AUTH") {
                socket
                    .write_all(b"235 Authentication successful\r\n")
                    .unwrap()
            } else if line.starts_with("MAIL FROM") || line.starts_with("RCPT TO") {
                socket.write_all(b"250 OK\r\n").unwrap()
            } else if line == "DATA\r\n" {
                socket.write_all(b"354 End with dot\r\n").unwrap();
                loop {
                    let mut data = String::new();
                    reader.read_line(&mut data).unwrap();
                    if data == ".\r\n" {
                        break;
                    }
                    captured.push_str(&data)
                }
                socket.write_all(b"250 Queued\r\n").unwrap();
                break;
            } else {
                panic!("Unexpected SMTP command")
            }
        }
        captured
    });
    let draft = Compose {
        id: "fixture".into(),
        account_id: a.id.clone(),
        to: "recipient@example.test".into(),
        cc: "copy@example.test".into(),
        subject: "Re: Local fixture".into(),
        body: "SMTP fixture body".into(),
        attachments: vec![Attachment {
            name: "sample.txt".into(),
            mime: "text/plain".into(),
            size: 2,
            data: "aGk=".into(),
        }],
        in_reply_to: "<previous@example.test>".into(),
        references: "<previous@example.test>".into(),
    };
    let message = mail::build_message(&a, &draft).unwrap();
    mail::smtp(&a, "fixture-password")
        .unwrap()
        .send(&message)
        .unwrap();
    let captured = server.join().unwrap();
    assert!(captured.contains("In-Reply-To: <previous@example.test>"));
    assert!(captured.contains("sample.txt"));
    assert!(captured.contains("recipient@example.test"));
    assert!(captured.contains("SMTP fixture body"));
    assert!(!captured.contains("fixture-password"));
}
